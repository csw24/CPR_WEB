
#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Adafruit_ADS1X15.h>
#include <Adafruit_VL53L0X.h>
#include <MFRC522.h>
#include <DFRobotDFPlayerMini.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ================================================
// 1. PIN SETTINGS
// ================================================

// I2C
#define I2C_SDA 21
#define I2C_SCL 22

// LCD ST7789V
#define TFT_SCK  18
#define TFT_MOSI 23
#define TFT_CS   32
#define TFT_DC   17
#define TFT_RST  16
#define TFT_BL   25

// RFID MFRC522
#define RFID_SS  33
#define RFID_RST 14

// DFPlayer Mini
#define DF_RX 26
#define DF_TX 27

// Start Button
#define START_BUTTON 13

// SDP810
#define SDP810_ADDR 0x25

// FSR threshold
#define FSR1_THRESHOLD 7000

// correct_position audio track
#define CORRECT_POSITION_TRACK 7

// ================================================
// 2. OBJECTS
// ================================================

Adafruit_ST7789 tft =
  Adafruit_ST7789(TFT_CS, TFT_DC, TFT_RST);

Adafruit_ADS1115 ads;
Adafruit_VL53L0X tof;

MFRC522 rfid(RFID_SS, RFID_RST);

HardwareSerial dfSerial(2);
DFRobotDFPlayerMini dfPlayer;

// ================================================
// 3. SENSOR STATUS
// ================================================

bool adsReady = false;
bool tofReady = false;
bool rfidReady = false;
bool audioReady = false;
bool sdpReady = false;

bool tofValid = false;

// Screen status
bool dashboardActive = false;

// ================================================
// 4. SENSOR DATA
// ================================================

// FSR 1, 2
int16_t fsr1Raw = 0;
int16_t fsr2Raw = 0;

float fsr1Voltage = 0;
float fsr2Voltage = 0;

// ToF
uint16_t distanceMM = 0;

// RFID
String lastUID = "Waiting...";

// Audio
int audioVolume = 25;

bool correctPositionTriggered = false;

// ================================================
// 5. BUTTON SETTINGS
// ================================================

bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;

unsigned long lastDebounceTime = 0;

const unsigned long debounceDelay = 50;

// ================================================
// 6. TIMING
// ================================================

unsigned long lastADC = 0;
unsigned long lastToF = 0;
unsigned long lastRFID = 0;
unsigned long lastLCD = 0;

const unsigned long ADC_INTERVAL = 100;
const unsigned long TOF_INTERVAL = 150;
const unsigned long RFID_INTERVAL = 50;
const unsigned long LCD_INTERVAL = 250;

// ================================================
// 6A. BLE + SESSION ACCUMULATION
// ================================================
// Web Bluetooth: service UUID and characteristic UUID must match the website.
#define CPR_SERVICE_UUID "f7e10001-6b39-4e2e-9c2a-11c0de000001"
#define CPR_DATA_UUID    "f7e10002-6b39-4e2e-9c2a-11c0de000001"
#define CPR_CMD_UUID     "f7e10003-6b39-4e2e-9c2a-11c0de000001"

BLECharacteristic* bleData = nullptr;
bool bleConnected = false;
bool sessionFinished = false;
unsigned long sessionStartedAt = 0;
unsigned long sessionDurationMs = 0;
uint32_t sessionNumber = 0;
uint32_t fsrSamples = 0, tofSamples = 0;
double fsr1Sum = 0, fsr2Sum = 0, tofSumMM = 0;
int16_t fsr1Peak = 0, fsr2Peak = 0;
uint16_t tofMinMM = 65535, tofMaxMM = 0;
String sessionUIDs = "";

// RFID UID determines which student's raw samples are accumulated.
// Scan a tag after starting a session and again whenever students switch.
const String ST1_UID = "89BC3C8E";
const String ST2_UID = "87BC3C8E";
int activeStudent = 0;  // 0 = no recognized student, 1 = ST1, 2 = ST2
const unsigned long TURN_DURATION_MS = 120000UL;
// Reuse an existing track; no new SD audio file is required.
const int SWITCH_VOICE_TRACK = 18; // /mp3/0018.mp3: 교대하세요
const int FINISH_VOICE_TRACK = 19; // /mp3/0019.mp3: CPR 교육 종료
unsigned long turnStartedAt = 0;
bool awaitingSwitch = false;
int previousStudent = 0;
unsigned long switchDueAt = 0;
unsigned long switchGapTotalMs = 0;
unsigned long switchGapLastMs = 0;
unsigned int completedSwitches = 0;
String switchGapHistoryMs = ""; // comma-separated gaps in chronological order

struct StudentStats {
  uint32_t fsrSamples = 0;
  uint32_t tofSamples = 0;
  double fsr1Sum = 0;
  double fsr2Sum = 0;
  double tofSumMM = 0;
  int16_t fsr1Peak = 0;
  int16_t fsr2Peak = 0;
  uint16_t tofMinMM = 65535;
  uint16_t tofMaxMM = 0;
};
StudentStats st1Stats, st2Stats;

StudentStats* currentStats() {
  if (activeStudent == 1) return &st1Stats;
  if (activeStudent == 2) return &st2Stats;
  return nullptr;
}

String studentJSON(const StudentStats& s, const String& uid) {
  String j = "{\"uid\":\"" + uid + "\"";
  j += ",\"fsrSamples\":" + String(s.fsrSamples);
  j += ",\"fsr1MeanRaw\":" + String(s.fsrSamples ? s.fsr1Sum / s.fsrSamples : 0, 2);
  j += ",\"fsr2MeanRaw\":" + String(s.fsrSamples ? s.fsr2Sum / s.fsrSamples : 0, 2);
  j += ",\"fsr1PeakRaw\":" + String(s.fsr1Peak);
  j += ",\"fsr2PeakRaw\":" + String(s.fsr2Peak);
  j += ",\"tofSamples\":" + String(s.tofSamples);
  j += ",\"tofMeanMm\":" + String(s.tofSamples ? s.tofSumMM / s.tofSamples : 0, 2);
  j += ",\"tofMinMm\":" + String(s.tofSamples ? s.tofMinMM : 0);
  j += ",\"tofMaxMm\":" + String(s.tofMaxMM);
  j += "}";
  return j;
}
volatile bool sendRequested = false;

class CPRServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected = true; }
  void onDisconnect(BLEServer* server) override {
    bleConnected = false;
    server->getAdvertising()->start();
  }
};
class CPRCommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String cmd = String(c->getValue().c_str());
    cmd.trim();
    if (cmd.equalsIgnoreCase("GET")) sendRequested = true;
  }
};

void initBLE() {
  BLEDevice::init("XI:ON CPR");
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new CPRServerCallbacks());
  BLEService* service = server->createService(CPR_SERVICE_UUID);
  bleData = service->createCharacteristic(CPR_DATA_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  bleData->addDescriptor(new BLE2902());
  bleData->setValue("READY");
  BLECharacteristic* cmd = service->createCharacteristic(CPR_CMD_UUID,
    BLECharacteristic::PROPERTY_WRITE);
  cmd->setCallbacks(new CPRCommandCallbacks());
  service->start();
  BLEAdvertising* advertising = server->getAdvertising();
  advertising->addServiceUUID(CPR_SERVICE_UUID);
  advertising->start();
  Serial.println("BLE advertising: XI:ON CPR");
}

void resetSession() {
  fsrSamples = tofSamples = 0;
  fsr1Sum = fsr2Sum = tofSumMM = 0;
  fsr1Peak = fsr2Peak = 0;
  tofMinMM = 65535; tofMaxMM = 0;
  sessionUIDs = "";
  lastUID = "Waiting...";
  fsr1Raw = fsr2Raw = 0;
  fsr1Voltage = fsr2Voltage = 0;
  distanceMM = 0;
  tofValid = false;
  correctPositionTriggered = false;
  activeStudent = 0;
  turnStartedAt = 0;
  awaitingSwitch = false;
  previousStudent = 0;
  switchDueAt = 0;
  switchGapTotalMs = 0;
  switchGapLastMs = 0;
  completedSwitches = 0;
  switchGapHistoryMs = "";
  st1Stats = StudentStats();
  st2Stats = StudentStats();
  Serial.println("NEW SESSION: RFID cleared, ST1=0, ST2=0");
  sessionDurationMs = 0;
  sessionFinished = false;
  sendRequested = false;
  sessionStartedAt = millis();
  sessionNumber++;
}

void recordFSR() {
  fsrSamples++;
  fsr1Sum += fsr1Raw;
  fsr2Sum += fsr2Raw;
  if (fsr1Raw > fsr1Peak) fsr1Peak = fsr1Raw;
  if (fsr2Raw > fsr2Peak) fsr2Peak = fsr2Raw;
  StudentStats* s = currentStats();
  if (s) {
    s->fsrSamples++;
    s->fsr1Sum += fsr1Raw;
    s->fsr2Sum += fsr2Raw;
    if (fsr1Raw > s->fsr1Peak) s->fsr1Peak = fsr1Raw;
    if (fsr2Raw > s->fsr2Peak) s->fsr2Peak = fsr2Raw;
  }
}
void recordToF() {
  if (!tofValid) return;
  tofSamples++;
  tofSumMM += distanceMM;
  if (distanceMM < tofMinMM) tofMinMM = distanceMM;
  if (distanceMM > tofMaxMM) tofMaxMM = distanceMM;
  StudentStats* s = currentStats();
  if (s) {
    s->tofSamples++;
    s->tofSumMM += distanceMM;
    if (distanceMM < s->tofMinMM) s->tofMinMM = distanceMM;
    if (distanceMM > s->tofMaxMM) s->tofMaxMM = distanceMM;
  }
}

// The values are raw session statistics, NOT calibrated CPR depth/rate/quality.
String buildSessionJSON() {
  String j = "{\"version\":1,\"session\":" + String(sessionNumber);
  j += ",\"durationMs\":" + String(sessionDurationMs);
  j += ",\"fsrSamples\":" + String(fsrSamples);
  j += ",\"fsr1MeanRaw\":" + String(fsrSamples ? fsr1Sum/fsrSamples : 0, 2);
  j += ",\"fsr2MeanRaw\":" + String(fsrSamples ? fsr2Sum/fsrSamples : 0, 2);
  j += ",\"fsr1PeakRaw\":" + String(fsr1Peak);
  j += ",\"fsr2PeakRaw\":" + String(fsr2Peak);
  j += ",\"tofSamples\":" + String(tofSamples);
  j += ",\"tofMeanMm\":" + String(tofSamples ? tofSumMM/tofSamples : 0, 2);
  j += ",\"tofMinMm\":" + String(tofSamples ? tofMinMM : 0);
  j += ",\"tofMaxMm\":" + String(tofMaxMM);
  j += ",\"rfidUIDs\":\"" + sessionUIDs + "\"";
  j += ",\"A\":" + studentJSON(st1Stats, ST1_UID);
  j += ",\"B\":" + studentJSON(st2Stats, ST2_UID);
  j += ",\"switchCount\":" + String(completedSwitches);
  j += ",\"lastSwitchGapMs\":" + String(switchGapLastMs);
  j += ",\"avgSwitchGapMs\":" + String(completedSwitches ? switchGapTotalMs / completedSwitches : 0);
  j += ",\"switchGapsMs\":[" + switchGapHistoryMs + "]";
  j += "}";
  return j;
}

// Notifications use <= 20 bytes for compatibility with the default BLE MTU.
// Protocol: BEGIN:<byteLength> , payload fragments, END
void sendSessionBLE() {
  if (!bleConnected || !bleData || !sessionFinished) return;
  String payload = buildSessionJSON();
  String header = "BEGIN:" + String(payload.length());
  bleData->setValue(header.c_str()); bleData->notify(); delay(80);
  for (size_t i=0; i<payload.length(); i+=20) {
    if (!bleConnected) return;
    String part = payload.substring(i, i+20);
    bleData->setValue((uint8_t*)part.c_str(), part.length());
    bleData->notify(); delay(65);
  }
  bleData->setValue("END"); bleData->notify();
  Serial.println("BLE session sent: " + payload);
}

// ================================================
// 7. LCD COLORS
// ================================================

#define COLOR_BG      ST77XX_BLACK
#define COLOR_WHITE   ST77XX_WHITE
#define COLOR_CYAN    ST77XX_CYAN
#define COLOR_GREEN   ST77XX_GREEN
#define COLOR_YELLOW  ST77XX_YELLOW
#define COLOR_RED     ST77XX_RED

// ================================================
// 8. START SCREEN
// ================================================

void drawStartScreen() {

  tft.fillScreen(COLOR_BG);

  tft.setTextWrap(false);
  tft.setTextSize(2);
  tft.setTextColor(COLOR_CYAN);

  tft.setCursor(64, 110);
  tft.print("XI:ON SMART CPR");
}

// ================================================
// 9. SENSOR DASHBOARD
// ================================================

void drawDashboard() {

  tft.fillScreen(COLOR_BG);
  tft.setTextWrap(false);

  // RFID UID - Top
  tft.setTextSize(1);
  tft.setTextColor(COLOR_YELLOW);
  tft.setCursor(5, 5);
  tft.print("RFID UID:");

  tft.setTextColor(COLOR_GREEN);
  tft.setCursor(65, 5);
  tft.print(lastUID);

  tft.drawFastHLine(5, 22, 310, COLOR_WHITE);

  // Title
  tft.setTextSize(2);
  tft.setTextColor(COLOR_CYAN);
  tft.setCursor(5, 28);
  tft.print("XI:ON SMART CPR");

  tft.drawFastHLine(5, 52, 310, COLOR_WHITE);

  // Sensor connection status
  tft.setTextSize(1);
  tft.setTextColor(COLOR_WHITE);

  tft.setCursor(5, 59);
  tft.print("ADS:");

  tft.setCursor(80, 59);
  tft.print("TOF:");

  tft.setCursor(155, 59);
  tft.print("RFID:");

  tft.setCursor(235, 59);
  tft.print("SDP:");

  tft.drawFastHLine(5, 76, 310, COLOR_WHITE);

  // FSR
  tft.setTextSize(2);
  tft.setTextColor(COLOR_YELLOW);
  tft.setCursor(5, 82);
  tft.print("FSR PRESSURE");

  tft.setTextSize(1);
  tft.setTextColor(COLOR_WHITE);

  tft.setCursor(5, 111);
  tft.print("FSR 1:");

  tft.setCursor(165, 111);
  tft.print("FSR 2:");

  tft.drawFastHLine(5, 132, 310, COLOR_WHITE);

  // ToF
  tft.setTextSize(2);
  tft.setTextColor(COLOR_YELLOW);
  tft.setCursor(5, 139);
  tft.print("TOF DISTANCE");
}

// ================================================
// 10. UPDATE SENSOR STATUS
// ================================================

void printStatus(int x, int y, bool ready) {

  tft.fillRect(x, y, 45, 12, COLOR_BG);

  tft.setCursor(x, y);
  tft.setTextSize(1);

  if (ready) {
    tft.setTextColor(COLOR_GREEN);
    tft.print("OK");
  } else {
    tft.setTextColor(COLOR_RED);
    tft.print("ERROR");
  }
}

void updateSensorStatus() {

  printStatus(30, 59, adsReady);
  printStatus(105, 59, tofReady);
  printStatus(190, 59, rfidReady);
  printStatus(265, 59, sdpReady);
}

// ================================================
// 11. READ FSR 1 AND FSR 2
// ================================================

void readADC() {

  if (!adsReady) return;

  // Read AIN0 and AIN1
  fsr1Raw = ads.readADC_SingleEnded(0);
  fsr2Raw = ads.readADC_SingleEnded(1);

  // Convert to voltage
  fsr1Voltage = ads.computeVolts(fsr1Raw);
  fsr2Voltage = ads.computeVolts(fsr2Raw);

  // Serial output
  Serial.println("\n========== FSR DATA ==========");

  Serial.print("FSR 1 RAW: ");
  Serial.print(fsr1Raw);
  Serial.print(" | VOLTAGE: ");
  Serial.print(fsr1Voltage, 3);
  Serial.println(" V");

  Serial.print("FSR 2 RAW: ");
  Serial.print(fsr2Raw);
  Serial.print(" | VOLTAGE: ");
  Serial.print(fsr2Voltage, 3);
  Serial.println(" V");

  recordFSR();

  // FSR1 threshold: 7000
  if (fsr1Raw > FSR1_THRESHOLD &&
      !correctPositionTriggered) {

    Serial.println("FSR1 THRESHOLD EXCEEDED!");
    Serial.println("CORRECT_POSITION AUDIO");

    if (audioReady) {

      dfPlayer.play(CORRECT_POSITION_TRACK);

      Serial.println("Playing track 7");

    } else {

      Serial.println("DFPlayer NOT READY");
    }

    correctPositionTriggered = true;
  }

  // Reset trigger after releasing pressure
  if (fsr1Raw <= FSR1_THRESHOLD) {

    correctPositionTriggered = false;
  }
}

// ================================================
// 12. READ TOF
// ================================================

void readToF() {

  if (!tofReady) return;

  VL53L0X_RangingMeasurementData_t measure;

  // Previously confirmed working method
  tof.rangingTest(&measure, false);

  if (measure.RangeStatus == 0) {

    distanceMM = measure.RangeMilliMeter;
    tofValid = true;
    recordToF();

    Serial.print("TOF DISTANCE: ");
    Serial.print(distanceMM);
    Serial.println(" mm");

  } else {

    tofValid = false;

    Serial.println("TOF INVALID");
  }
}

// ================================================
// 13. READ RFID
// ================================================

void readRFID() {

  if (!rfidReady) return;

  if (!rfid.PICC_IsNewCardPresent()) return;

  if (!rfid.PICC_ReadCardSerial()) return;

  lastUID = "";

  for (byte i = 0; i < rfid.uid.size; i++) {

    if (rfid.uid.uidByte[i] < 0x10) {
      lastUID += "0";
    }

    lastUID += String(
      rfid.uid.uidByte[i],
      HEX
    );

    if (i < rfid.uid.size - 1) {
      lastUID += " ";
    }
  }

  lastUID.toUpperCase();
  String normalizedUID = lastUID;
  normalizedUID.replace(" ", "");
  if (dashboardActive) {
    int scannedStudent = 0;
    if (normalizedUID == ST1_UID) scannedStudent = 1;
    else if (normalizedUID == ST2_UID) scannedStudent = 2;

    if (scannedStudent == 0) {
      Serial.println("UNKNOWN RFID: ignored");
    } else if (awaitingSwitch) {
      if (scannedStudent != previousStudent) {
        unsigned long taggedAt = millis();
        switchGapLastMs = taggedAt - switchDueAt;
        switchGapTotalMs += switchGapLastMs;
        completedSwitches++;
        if (switchGapHistoryMs.length()) switchGapHistoryMs += ",";
        switchGapHistoryMs += String(switchGapLastMs);
        activeStudent = scannedStudent;
        awaitingSwitch = false;
        turnStartedAt = taggedAt;
        Serial.println("SWITCH CONFIRMED: ST" + String(activeStudent));
        Serial.println("SWITCH GAP (ms): " + String(switchGapLastMs));
      } else {
        Serial.println("SCAN OTHER STUDENT TO RESUME");
      }
    } else if (activeStudent == 0) {
      if (scannedStudent != 1) {
        Serial.println("ST1 RFID REQUIRED FIRST");
        rfid.PICC_HaltA();
        rfid.PCD_StopCrypto1();
        return;
      }
      activeStudent = scannedStudent;
      turnStartedAt = millis();
      Serial.println("FIRST STUDENT: ST" + String(activeStudent));
    } else if (scannedStudent != activeStudent) {
      Serial.println("WAIT FOR THE 2-MINUTE SWITCH PROMPT");
    }
    Serial.println("RFID ROUTING -> ST" + String(activeStudent) +
                   " | ST1 FSR=" + String(st1Stats.fsrSamples) +
                   " | ST2 FSR=" + String(st2Stats.fsrSamples));
  }
  if (dashboardActive && sessionUIDs.indexOf(lastUID) < 0) {
    if (sessionUIDs.length()) sessionUIDs += ",";
    sessionUIDs += lastUID;
  }

  Serial.print("RFID UID: ");
  Serial.println(lastUID);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// ================================================
// 14. UPDATE LCD DASHBOARD
// ================================================

void updateLCD() {

  if (!dashboardActive) return;

  updateSensorStatus();

  // -----------------------------
  // RFID UID
  // -----------------------------

  tft.fillRect(65, 3, 250, 16, COLOR_BG);

  tft.setCursor(65, 5);
  tft.setTextSize(1);
  tft.setTextColor(COLOR_GREEN);

  tft.print(lastUID);

  // -----------------------------
  // FSR 1
  // -----------------------------

  tft.fillRect(5, 122, 150, 9, COLOR_BG);

  tft.setCursor(5, 122);
  tft.setTextSize(1);
  tft.setTextColor(COLOR_GREEN);

  if (adsReady) {

    tft.print(fsr1Raw);
    tft.print(" / ");
    tft.print(fsr1Voltage, 3);
    tft.print("V");

  } else {

    tft.print("NO DATA");
  }

  // -----------------------------
  // FSR 2
  // -----------------------------

  tft.fillRect(165, 122, 145, 9, COLOR_BG);

  tft.setCursor(165, 122);
  tft.setTextSize(1);
  tft.setTextColor(COLOR_GREEN);

  if (adsReady) {

    tft.print(fsr2Raw);
    tft.print(" / ");
    tft.print(fsr2Voltage, 3);
    tft.print("V");

  } else {

    tft.print("NO DATA");
  }

  // -----------------------------
  // TOF DISTANCE
  // -----------------------------

  tft.fillRect(5, 160, 305, 18, COLOR_BG);

  tft.setCursor(5, 160);
  tft.setTextSize(2);

  if (tofReady && tofValid) {

    tft.setTextColor(COLOR_GREEN);

    tft.print(distanceMM / 10.0, 1);
    tft.print(" cm");

    tft.setTextSize(1);
    tft.print(" (");
    tft.print(distanceMM);
    tft.print(" mm)");

  } else {

    tft.setTextColor(COLOR_RED);
    tft.print("INVALID");
  }
}

// ================================================
// 15. START BUTTON
// ================================================

void checkStartButton() {

  bool reading = digitalRead(START_BUTTON);

  if (reading != lastButtonReading) {

    lastDebounceTime = millis();
  }

  if (millis() - lastDebounceTime > debounceDelay) {

    if (reading != stableButtonState) {

      stableButtonState = reading;

      // Button pressed
      if (stableButtonState == LOW) {
        if (dashboardActive) {
          dashboardActive = false;
          sessionDurationMs = millis() - sessionStartedAt;
          sessionFinished = true;
          drawStartScreen();
          Serial.println("SESSION FINISHED - BLE GET available");
          Serial.println(buildSessionJSON());
          return;
        }
        resetSession();
        dashboardActive = true;

        Serial.println("\nDASHBOARD STARTED");

        // Switch screen
        drawDashboard();

        // Initial display
        updateLCD();

        // Reset timing
        lastADC = millis();
        lastToF = millis();
        lastRFID = millis();
        lastLCD = millis();
      }
    }
  }

  lastButtonReading = reading;
}

// ================================================
// 16. AUDIO SERIAL COMMANDS
// ================================================

void checkAudioCommand() {

  static String inputBuffer = "";

  while (Serial.available()) {

    char input = Serial.read();

    if (input == '\n' || input == '\r') {

      inputBuffer.trim();

      if (inputBuffer.length() > 0) {

        if (inputBuffer == "+") {

          audioVolume++;

          if (audioVolume > 30) {
            audioVolume = 30;
          }

          if (audioReady) {
            dfPlayer.volume(audioVolume);
          }

          Serial.print("Volume: ");
          Serial.println(audioVolume);

        } else if (inputBuffer == "-") {

          audioVolume--;

          if (audioVolume < 0) {
            audioVolume = 0;
          }

          if (audioReady) {
            dfPlayer.volume(audioVolume);
          }

          Serial.print("Volume: ");
          Serial.println(audioVolume);

        } else if (
          inputBuffer.equalsIgnoreCase("S")
        ) {

          if (audioReady) {
            dfPlayer.stop();
          }

          Serial.println("Audio stopped");

        } else {

          int track = inputBuffer.toInt();

          if (audioReady && track >= 1 && track <= 17) {

            dfPlayer.play(track);

            Serial.print("Playing track: ");
            Serial.println(track);
          }
        }

        inputBuffer = "";
      }

    } else if (
      (input >= '0' && input <= '9') ||
      input == '+' ||
      input == '-' ||
      input == 's' ||
      input == 'S'
    ) {

      if (inputBuffer.length() < 3) {

        inputBuffer += input;
      }
    }
  }
}

// ================================================
// 17. SETUP
// ================================================

void setup() {

  Serial.begin(115200);
  delay(1000);

  Serial.println("\n================================");
  Serial.println("XI:ON SMART CPR");
  Serial.println("SENSOR INTEGRATED TEST");
  Serial.println("================================");

  initBLE();

  // Start button
  pinMode(START_BUTTON, INPUT_PULLUP);

  // LCD Backlight
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);

  // I2C
  Wire.begin(I2C_SDA, I2C_SCL);

  // SPI
  SPI.begin(
    TFT_SCK,
    19,
    TFT_MOSI,
    TFT_CS
  );

  // LCD
  tft.init(240, 320);
  tft.setRotation(1);
  tft.fillScreen(COLOR_BG);

  // Show only project title
  drawStartScreen();

  // -----------------------------
  // ADS1115
  // -----------------------------

  Serial.println("\n[ADS1115]");

  adsReady = ads.begin(0x48);

  if (adsReady) {

    ads.setGain(GAIN_ONE);

    Serial.println("ADS1115 READY");

  } else {

    Serial.println("ADS1115 FAILED");
  }

  // -----------------------------
  // VL53L0X
  // -----------------------------

  Serial.println("\n[TOF]");

  // Confirmed working initialization
  tofReady = tof.begin();

  if (tofReady) {

    Serial.println("VL53L0X READY");

  } else {

    Serial.println("VL53L0X FAILED");
  }

  // -----------------------------
  // RFID
  // -----------------------------

  Serial.println("\n[RFID]");

  rfid.PCD_Init();
  delay(50);

  byte version = rfid.PCD_ReadRegister(
    MFRC522::VersionReg
  );

  if (version != 0x00 && version != 0xFF) {

    rfidReady = true;

    Serial.print("RFID READY: 0x");
    Serial.println(version, HEX);

  } else {

    rfidReady = false;

    Serial.println("RFID FAILED");
  }

  // -----------------------------
  // SDP810
  // -----------------------------

  Serial.println("\n[SDP810]");

  Wire.beginTransmission(SDP810_ADDR);

  if (Wire.endTransmission() == 0) {

    sdpReady = true;

    Serial.println("SDP810 I2C ACK: OK");

  } else {

    sdpReady = false;

    Serial.println("SDP810 NOT FOUND");
  }

  // -----------------------------
  // DFPLAYER
  // -----------------------------

  Serial.println("\n[DFPLAYER]");

  dfSerial.begin(
    9600,
    SERIAL_8N1,
    DF_RX,
    DF_TX
  );

  if (dfPlayer.begin(dfSerial)) {

    audioReady = true;

    dfPlayer.volume(audioVolume);

    Serial.println("DFPLAYER READY");

  } else {

    audioReady = false;

    Serial.println("DFPLAYER FAILED");
  }

  // -----------------------------
  // COMPLETE
  // -----------------------------

  Serial.println("\n================================");
  Serial.println("INITIALIZATION COMPLETE");
  Serial.println("Press START button to open dashboard.");
  Serial.println("================================");

  Serial.println("Audio commands:");
  Serial.println("1-17 : Play track");
  Serial.println("+    : Volume up");
  Serial.println("-    : Volume down");
  Serial.println("S    : Stop");
}

// ================================================
// 18. MAIN LOOP
// ================================================

void loop() {

  // Always check start button
  checkStartButton();
  if (sendRequested) {
    sendRequested = false;
    sendSessionBLE();
  }

  // Wait for start button
  if (!dashboardActive) {

    checkAudioCommand();

    return;
  }

  unsigned long now = millis();

  // Two-minute turn timer starts on the first recognized RFID scan.
  // At the limit, pause per-student accumulation until the OTHER tag is scanned.
  if (activeStudent != 0 && !awaitingSwitch &&
      now - turnStartedAt >= TURN_DURATION_MS) {
    if (activeStudent == 2) {
      // ST2 completes the final two-minute turn. Stop accumulation and preserve BLE data.
      activeStudent = 0;
      awaitingSwitch = false;
      dashboardActive = false;
      sessionDurationMs = millis() - sessionStartedAt;
      sessionFinished = true;
      if (audioReady) dfPlayer.playMp3Folder(FINISH_VOICE_TRACK);
      drawStartScreen();
      Serial.println("ST2 FINISHED - SESSION COMPLETE - BLE GET AVAILABLE");
      Serial.println(buildSessionJSON());
      return;
    }
    previousStudent = 1;
    switchDueAt = turnStartedAt + TURN_DURATION_MS;
    activeStudent = 0;
    awaitingSwitch = true;
    Serial.println("ST1 FINISHED - SCAN ST2 RFID");
    if (audioReady) dfPlayer.playMp3Folder(SWITCH_VOICE_TRACK);
  }

  // FSR measurement
  if (now - lastADC >= ADC_INTERVAL) {

    lastADC = now;

    readADC();
  }

  // ToF measurement
  if (now - lastToF >= TOF_INTERVAL) {

    lastToF = now;

    readToF();
  }

  // RFID measurement
  if (now - lastRFID >= RFID_INTERVAL) {

    lastRFID = now;

    readRFID();
  }

  // LCD update
  if (now - lastLCD >= LCD_INTERVAL) {

    lastLCD = now;

    updateLCD();
  }

  // Audio commands
  checkAudioCommand();
}