
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

// Forward declaration: required by Arduino IDE auto-generated prototypes.
typedef struct StudentStats StudentStats;

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
#define FSR1_THRESHOLD 5000

// Audio track numbers in /mp3 folder
#define BREATH_NOT_DETECTED_TRACK  1
#define CALIBRATION_TRACK          2
#define BREATH_DETECTED_TRACK      3
#define CALIBRATION_COMPLETE_TRACK 4
#define CORRECT_DEPTH_TRACK        5
#define CORRECT_POSITION_TRACK     6
#define CPR_COMPLETE_TRACK         7
#define FASTER_TRACK               8
#define PRESS_HARDER_TRACK         9
#define PRESS_LIGHTER_TRACK        10
#define RELEASE_TRACK              11
#define RFID_ERROR_TRACK           12
#define SENSOR_ERROR_TRACK         13
#define SLOWER_TRACK               14
#define START_CPR_TRACK            15
#define USER_IDENTIFIED_TRACK      16
#define WRONG_POSITION_TRACK      17
#define STUDENT1_IDENTIFIED_TRACK  21
#define STUDENT2_IDENTIFIED_TRACK  22
#define CPR_30_COMPLETE_TRACK      23
#define BREATH_1_DETECTED_TRACK    24
#define BREATH_2_DETECTED_TRACK    25
#define BREATHS_COMPLETE_TRACK     26

#define FSR1_AUDIO_THRESHOLD 4000

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

// Baseline calibration from 3 uploaded 60-second CSV trials (1,800 valid samples).
// Trial means: 187.378, 187.290, 187.220 mm
// Combined mean: 187.296 mm; use 187.30 mm as the fixed baseline.
const float TOF_BASELINE_MM = 187.30f;

// The CSV baseline standard deviation was approximately 1.61 mm.
// Treat changes within +/-5 mm as sensor/mounting noise (display depth as zero).
const float TOF_NOISE_DEADBAND_MM = 5.0f;

float tofDepthMM = 0.0f;

// SDP810 differential pressure
int16_t sdpPressureRaw = 0;
int16_t sdpTemperatureRaw = 0;
float sdpPressurePa = 0.0f;
float sdpTemperatureC = 0.0f;
bool sdpDataValid = false;

// RFID
String lastUID = "Waiting...";

// Audio
int audioVolume = 25;

bool correctPositionTriggered = false;
bool fsrAudioTriggered = false;
bool breathAudioTriggered = false;
const float BREATH_AUDIO_THRESHOLD_PA = -2.0f;
const float BREATH_AUDIO_RESET_PA = -0.3f;

// CPR training logic (ToF depth is measured relative to the 187.30 mm baseline).
const float CPR_COUNT_DEPTH_MM = 30.0f;       // Count a compression at >= 3 cm
const float CPR_RELEASE_DEPTH_MM = 10.0f;     // Re-arm after chest release
const float CPR_GOOD_DEPTH_MIN_MM = 50.0f;    // Target depth: 5-6 cm
const float CPR_GOOD_DEPTH_MAX_MM = 60.0f;
const unsigned long CPR_MIN_INTERVAL_MS = 250;
const uint8_t CPR_TARGET_COMPRESSIONS = 30;
const uint8_t CPR_TARGET_BREATHS = 2;

bool compressionArmed = true;
uint8_t compressionCount = 0;
uint8_t breathCount = 0;
bool ventilationPhase = false;
float compressionPeakMM = 0;
bool compressionRecoilSeen = false;
unsigned long lastCountedCompressionMs = 0;
unsigned long lastCompressionAt = 0;
unsigned long compressionIntervals[3] = {0, 0, 0};
uint8_t intervalIndex = 0;
uint8_t intervalCount = 0;
float compressionRateCPM = 0.0f;
String depthFeedback = "WAITING";
String rateFeedback = "WAITING";

void processCompression();
void processBreathDetection();
// Audio prompt scheduler: time-critical cues preempt normal feedback.
unsigned long lastSwitchPromptMs = 0;
unsigned long lastBreathPromptMs = 0;
unsigned long pendingBreathsCompleteAt = 0;
unsigned long audioProtectedUntilMs = 0;
const unsigned long PROMPT_REPEAT_MS = 1000UL;
extern const int SWITCH_VOICE_TRACK;
// These globals are defined below; declare them before the prompt scheduler uses them.
extern bool awaitingSwitch;
extern int activeStudent;
void playPriorityPrompt(int track, const char* description) {
  if (!audioReady) return;
  dfPlayer.playMp3Folder(track);
  audioProtectedUntilMs = millis() + PROMPT_REPEAT_MS;
  Serial.print("PRIORITY AUDIO: "); Serial.println(description);
}
void servicePriorityPrompts() {
  if (!dashboardActive || !audioReady) return;
  unsigned long now = millis();
  if (pendingBreathsCompleteAt && (long)(now - pendingBreathsCompleteAt) >= 0) {
    pendingBreathsCompleteAt = 0;
    playPriorityPrompt(BREATHS_COMPLETE_TRACK, "0026: resume compressions");
    return;
  }
  if (awaitingSwitch) {
    if (lastSwitchPromptMs == 0 || now - lastSwitchPromptMs >= PROMPT_REPEAT_MS) {
      playPriorityPrompt(SWITCH_VOICE_TRACK, "0018: switch students");
      lastSwitchPromptMs = now ? now : 1;
    }
  } else if (ventilationPhase && activeStudent != 0) {
    if (lastBreathPromptMs == 0 || now - lastBreathPromptMs >= PROMPT_REPEAT_MS) {
      playPriorityPrompt(CPR_30_COMPLETE_TRACK, "0023: give breaths");
      lastBreathPromptMs = now ? now : 1;
    }
  }
}


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
unsigned long lastSDP = 0;

const unsigned long ADC_INTERVAL = 100;
const unsigned long TOF_INTERVAL = 50;  // 20 Hz target for compression-cycle detection
const unsigned long RFID_INTERVAL = 50;
const unsigned long LCD_INTERVAL = 250;
const unsigned long SDP_INTERVAL = 200;

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
// No switch announcement exists in the supplied 0001-0017 audio set.
extern const int SWITCH_VOICE_TRACK = 18;
const int FINISH_VOICE_TRACK = 19;
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
  uint32_t compressionTotal = 0, goodDepthTotal = 0, fullRecoilTotal = 0;
  uint32_t breathTotal = 0, rateIntervals = 0;
  double depthPeakSumMM = 0, rateIntervalSumMs = 0;
  String depthPeaksMM = "";
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
  j += ",\"compressionCount\":" + String(s.compressionTotal);
  j += ",\"goodDepthCount\":" + String(s.goodDepthTotal);
  j += ",\"recoilCount\":" + String(s.fullRecoilTotal);
  j += ",\"breathCount\":" + String(s.breathTotal);
  j += ",\"averageDepthMm\":" + String(s.compressionTotal ? s.depthPeakSumMM / s.compressionTotal : 0, 2);
  j += ",\"depthCompliancePct\":" + String(s.compressionTotal ? 100.0 * s.goodDepthTotal / s.compressionTotal : 0, 2);
  j += ",\"recoilPct\":" + String(s.compressionTotal ? 100.0 * s.fullRecoilTotal / s.compressionTotal : 0, 2);
  j += ",\"rateCpm\":" + String(s.rateIntervals ? 60000.0 * s.rateIntervals / s.rateIntervalSumMs : 0, 2);
  j += ",\"depthPeaksMm\":[" + s.depthPeaksMM + "]";
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
  tofDepthMM = 0.0f;
  tofValid = false;
  sdpPressureRaw = 0;
  sdpTemperatureRaw = 0;
  sdpPressurePa = 0.0f;
  sdpTemperatureC = 0.0f;
  sdpDataValid = false;
  correctPositionTriggered = false;
  fsrAudioTriggered = false;
  breathAudioTriggered = false;
  lastSwitchPromptMs = lastBreathPromptMs = pendingBreathsCompleteAt = audioProtectedUntilMs = 0;
  compressionArmed = true;
  compressionCount = 0;
  breathCount = 0;
  ventilationPhase = false;
  compressionPeakMM = 0; compressionRecoilSeen = false; lastCountedCompressionMs = 0;
  lastCompressionAt = 0;
  compressionIntervals[0] = compressionIntervals[1] = compressionIntervals[2] = 0;
  intervalIndex = 0;
  intervalCount = 0;
  compressionRateCPM = 0.0f;
  depthFeedback = "WAITING";
  rateFeedback = "WAITING";
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

  // CPR guidance and breath pressure
  tft.drawFastHLine(5, 184, 310, COLOR_WHITE);
  tft.setTextSize(1);
  tft.setTextColor(COLOR_YELLOW);
  tft.setCursor(5, 188);
  tft.print("CPR COUNT / RATE / FEEDBACK");
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

  // Play 0010.mp3 (press_lighter) once when FSR1 raw value exceeds 4000.
  if (fsr1Raw > FSR1_AUDIO_THRESHOLD && !fsrAudioTriggered) {
    Serial.println("FSR1 > 4000: PRESS LIGHTER AUDIO");

    if (audioReady && !awaitingSwitch && !ventilationPhase && millis() >= audioProtectedUntilMs) {
      dfPlayer.playMp3Folder(PRESS_LIGHTER_TRACK);
      Serial.println("Playing /mp3/0010.mp3 (press_lighter)");
    } else {
      Serial.println("DFPlayer NOT READY");
    }

    fsrAudioTriggered = true;
  }

  // Re-arm after FSR1 returns to 4000 or below.
  if (fsr1Raw <= FSR1_AUDIO_THRESHOLD) {
    fsrAudioTriggered = false;
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

    // Chest compression should reduce the sensor-to-chest distance.
    // Depth = baseline distance - current distance.
    float displacementMM = TOF_BASELINE_MM - (float)distanceMM;

    // Ignore small changes within the measured baseline noise band.
    if (displacementMM <= TOF_NOISE_DEADBAND_MM) {
      tofDepthMM = 0.0f;
    } else {
      tofDepthMM = displacementMM;
    }

    recordToF();

    Serial.print("TOF DISTANCE: ");
    Serial.print(distanceMM);
    Serial.print(" mm | BASELINE: ");
    Serial.print(TOF_BASELINE_MM, 2);
    Serial.print(" mm | CPR DEPTH: ");
    Serial.print(tofDepthMM, 1);
    Serial.println(" mm");

    processCompression();

  } else {

    tofValid = false;

    Serial.println("TOF INVALID");
  }
}

// ================================================
// CPR COMPRESSION / RATE / 30:2 STATE MACHINE
// ================================================

void playCPRTrack(int track, const char *label) {
  if (audioReady) {
    if (awaitingSwitch || (ventilationPhase && track != BREATH_1_DETECTED_TRACK && track != BREATH_2_DETECTED_TRACK && track != BREATHS_COMPLETE_TRACK && track != CPR_30_COMPLETE_TRACK)) return;
    dfPlayer.playMp3Folder(track);
    Serial.print("CPR AUDIO: ");
    Serial.println(label);
  } else {
    Serial.print("CPR AUDIO SKIPPED (DFPlayer unavailable): ");
    Serial.println(label);
  }
}

// Each completed compression is evaluated using its PEAK depth, not the
// first sample crossing 30 mm. Release must reach <= 10 mm to re-arm.
void finishCompression() {
  StudentStats* st = currentStats();
  if (st && compressionPeakMM >= CPR_COUNT_DEPTH_MM) {
    st->compressionTotal++;
    st->depthPeakSumMM += compressionPeakMM;
    if (compressionPeakMM >= CPR_GOOD_DEPTH_MIN_MM && compressionPeakMM <= CPR_GOOD_DEPTH_MAX_MM) st->goodDepthTotal++;
    if (compressionRecoilSeen) st->fullRecoilTotal++;
    if (st->depthPeaksMM.length()) st->depthPeaksMM += ",";
    st->depthPeaksMM += String(compressionPeakMM, 1);
  }
  compressionPeakMM = 0;
  compressionRecoilSeen = false;
}

void processCompression() {
  if (!tofReady || !tofValid || ventilationPhase || !dashboardActive ||
      activeStudent == 0 || awaitingSwitch) return;

  if (tofDepthMM < CPR_GOOD_DEPTH_MIN_MM) depthFeedback = "PRESS HARDER";
  else if (tofDepthMM <= CPR_GOOD_DEPTH_MAX_MM) depthFeedback = "GOOD DEPTH";
  else depthFeedback = "PRESS LIGHTER";

  unsigned long now = millis();
  if (!compressionArmed) {
    if (tofDepthMM > compressionPeakMM) compressionPeakMM = tofDepthMM;
    if (tofDepthMM <= CPR_RELEASE_DEPTH_MM) {
      compressionRecoilSeen = true;
      finishCompression();
      compressionArmed = true;
      if (compressionCount >= CPR_TARGET_COMPRESSIONS) {
        ventilationPhase = true;
        breathCount = 0;
        lastCountedCompressionMs = 0;
        lastBreathPromptMs = 0;
        playPriorityPrompt(CPR_30_COMPLETE_TRACK, "0023: give breaths");
        lastBreathPromptMs = millis();
      }
    }
    return;
  }
  if (tofDepthMM < CPR_COUNT_DEPTH_MM) return;
  if (lastCompressionAt != 0 && now - lastCompressionAt < CPR_MIN_INTERVAL_MS) return;

  StudentStats* st = currentStats();
  if (st && lastCountedCompressionMs != 0 && now - lastCountedCompressionMs < 1500UL) {
    st->rateIntervals++;
    st->rateIntervalSumMs += now - lastCountedCompressionMs;
  }
  lastCountedCompressionMs = now;
  if (lastCompressionAt != 0 && now - lastCompressionAt < 1500UL) {
    compressionIntervals[intervalIndex] = now - lastCompressionAt;
    intervalIndex = (intervalIndex + 1) % 3;
    if (intervalCount < 3) intervalCount++;
    unsigned long sum = 0;
    for (uint8_t i = 0; i < intervalCount; i++) sum += compressionIntervals[i];
    if (sum) compressionRateCPM = 60000.0f * intervalCount / sum;
  }
  lastCompressionAt = now;
  compressionCount++;
  compressionArmed = false;
  compressionPeakMM = tofDepthMM;
  compressionRecoilSeen = false;
  if (compressionRateCPM > 0) {
    rateFeedback = compressionRateCPM < 100 ? "FASTER" :
                   compressionRateCPM > 120 ? "SLOWER" : "GOOD RATE";
  } else rateFeedback = "MEASURING";
  Serial.printf("COMPRESSION %u/30 | depth %.1f mm | rate %.1f cpm\n",
                compressionCount, tofDepthMM, compressionRateCPM);
  if (compressionCount >= CPR_TARGET_COMPRESSIONS) {
    // Finalize this compression on its release, before entering breath phase.
    // Ventilation begins after release to preserve the last peak.
    rateFeedback = "GIVE 2 BREATHS";
  }
}

void processBreathDetection() {
  if (!ventilationPhase || !sdpReady || !sdpDataValid) return;

  // A breath is counted once at <= -2 Pa; re-arm only after pressure rises above -0.3 Pa.
  if (sdpPressurePa <= BREATH_AUDIO_THRESHOLD_PA && !breathAudioTriggered) {
    breathAudioTriggered = true;
    breathCount++;
    StudentStats* st = currentStats();
    if (st) st->breathTotal++;

    if (breathCount == 1) {
      playPriorityPrompt(BREATH_1_DETECTED_TRACK, "0024: first breath detected");
      lastBreathPromptMs = millis();
    } else if (breathCount == 2) {
      playPriorityPrompt(BREATH_2_DETECTED_TRACK, "0025: second breath detected");
      // Track 0026 follows after 0025 has had time to play (non-blocking).
      pendingBreathsCompleteAt = millis() + 1100UL;
      ventilationPhase = false;
      compressionCount = 0;
      breathCount = 0;
      compressionArmed = true;
      lastCompressionAt = 0;
      lastCountedCompressionMs = 0;
      intervalIndex = 0;
      intervalCount = 0;
      compressionRateCPM = 0.0f;
      compressionIntervals[0] = compressionIntervals[1] = compressionIntervals[2] = 0;
      depthFeedback = "START COMPRESSIONS";
      rateFeedback = "MEASURING";
      Serial.println("2 BREATHS COMPLETE: COMPRESSION COUNT RESET TO 0");
    }
  }

  if (sdpPressurePa > BREATH_AUDIO_RESET_PA) {
    breathAudioTriggered = false;
  }
}

// ================================================
// 13. READ SDP810 DIFFERENTIAL PRESSURE
// ================================================

// Sensirion SDP8xx CRC-8: polynomial 0x31, initial value 0xFF.
uint8_t sdpCRC8(const uint8_t *data, uint8_t length) {
  uint8_t crc = 0xFF;

  for (uint8_t i = 0; i < length; i++) {
    crc ^= data[i];

    for (uint8_t bit = 0; bit < 8; bit++) {
      if (crc & 0x80) {
        crc = (crc << 1) ^ 0x31;
      } else {
        crc <<= 1;
      }
    }
  }

  return crc;
}

bool sendSDP810Command(uint16_t command) {
  Wire.beginTransmission(SDP810_ADDR);
  Wire.write((uint8_t)(command >> 8));
  Wire.write((uint8_t)(command & 0xFF));
  return Wire.endTransmission() == 0;
}

void startSDP810ContinuousMeasurement() {
  // Match the standalone working sketch:
  // stop any previous continuous measurement, then start SDP810 measurement.
  if (!sendSDP810Command(0x3FF9)) {
    sdpReady = false;
    Serial.println("SDP810 STOP COMMAND FAILED");
    return;
  }
  delay(10);

  if (!sendSDP810Command(0x3615)) {
    sdpReady = false;
    Serial.println("SDP810 MEASUREMENT START FAILED");
    return;
  }

  delay(50);
  sdpReady = true;
  Serial.println("SDP810 MEASUREMENT STARTED (0x3615)");
}

void readSDP810() {
  if (!sdpReady) return;

  const uint8_t bytesToRead = 9;
  uint8_t received = Wire.requestFrom((uint8_t)SDP810_ADDR, bytesToRead);

  if (received != bytesToRead) {
    sdpDataValid = false;
    while (Wire.available()) Wire.read();
    Serial.print("SDP810 READ ERROR, bytes received: ");
    Serial.println(received);
    return;
  }

  uint8_t data[9];
  for (uint8_t i = 0; i < bytesToRead; i++) {
    data[i] = Wire.read();
  }

  // Each 16-bit measurement is followed by its own CRC byte.
  if (sdpCRC8(&data[0], 2) != data[2] ||
      sdpCRC8(&data[3], 2) != data[5] ||
      sdpCRC8(&data[6], 2) != data[8]) {
    sdpDataValid = false;
    Serial.println("SDP810 CRC ERROR");
    return;
  }

  sdpPressureRaw = (int16_t)(((uint16_t)data[0] << 8) | data[1]);
  sdpTemperatureRaw = (int16_t)(((uint16_t)data[3] << 8) | data[4]);

  // Match standalone sketch: read scale factor from the third data word.
  uint16_t scaleFactor =
      ((uint16_t)data[6] << 8) | data[7];

  if (scaleFactor == 0) {
    sdpDataValid = false;
    Serial.println("SDP810 INVALID SCALE FACTOR");
    return;
  }

  sdpPressurePa = (float)sdpPressureRaw / (float)scaleFactor;
  sdpTemperatureC = (float)sdpTemperatureRaw / 200.0f;
  sdpDataValid = true;

  Serial.print("SDP810 | RAW: ");
  Serial.print(sdpPressureRaw);
  Serial.print(" | Differential Pressure: ");
  Serial.print(sdpPressurePa, 2);
  Serial.print(" Pa | Temperature: ");
  Serial.print(sdpTemperatureC, 2);
  Serial.println(" C");

  // Breath counting is handled by the CPR 30:2 state machine.
  processBreathDetection();
}

// ================================================
// 14. READ RFID
// ================================================

void readRFID() {

  if (!rfidReady) return;

  // LCD and MFRC522 share the SPI bus.
  // Keep the LCD deselected while polling the RFID reader.
  digitalWrite(TFT_CS, HIGH);
  digitalWrite(RFID_SS, HIGH);

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
    } else {
      if (audioReady && !awaitingSwitch) {
        const int studentVoiceTrack =
            (scannedStudent == 1) ? STUDENT1_IDENTIFIED_TRACK
                                  : STUDENT2_IDENTIFIED_TRACK;
        dfPlayer.playMp3Folder(studentVoiceTrack);
        Serial.print("Playing student identification voice: ST");
        Serial.print(scannedStudent);
        Serial.print(" (/mp3/");
        if (studentVoiceTrack < 10) Serial.print("000");
        else Serial.print("00");
        Serial.print(studentVoiceTrack);
        Serial.println(".mp3)");
      }
    }

    if (scannedStudent != 0 && awaitingSwitch) {
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
        compressionArmed = true; compressionCount = 0; breathCount = 0;
        ventilationPhase = false; lastCompressionAt = 0; lastCountedCompressionMs = 0;
        compressionPeakMM = 0; compressionRecoilSeen = false;
        lastSwitchPromptMs = 0;
        if (audioReady) dfPlayer.playMp3Folder(STUDENT2_IDENTIFIED_TRACK);
        Serial.println("SWITCH CONFIRMED: ST" + String(activeStudent));
        Serial.println("SWITCH GAP (ms): " + String(switchGapLastMs));
      } else {
        Serial.println("SCAN OTHER STUDENT TO RESUME");
      }
    } else if (scannedStudent != 0 && activeStudent == 0) {
      if (scannedStudent != 1) {
        Serial.println("ST1 RFID REQUIRED FIRST");
        rfid.PICC_HaltA();
        rfid.PCD_StopCrypto1();
        return;
      }
      activeStudent = scannedStudent;
      turnStartedAt = millis();
      Serial.println("FIRST STUDENT: ST" + String(activeStudent));
    } else if (scannedStudent != 0 && scannedStudent != activeStudent) {
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
// 15. UPDATE LCD DASHBOARD
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
  // TOF DISTANCE + CALCULATED CPR DEPTH
  // -----------------------------

  tft.fillRect(5, 156, 305, 27, COLOR_BG);

  if (tofReady && tofValid) {

    // Current sensor-to-chest distance
    tft.setCursor(5, 156);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_GREEN);
    tft.print("Distance: ");
    tft.print(distanceMM);
    tft.print(" mm");

    // Compression depth relative to the CSV-derived baseline
    tft.setCursor(5, 170);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_CYAN);
    tft.print("CPR Depth: ");
    tft.print(tofDepthMM, 1);
    tft.print(" mm");

  } else {

    tft.setCursor(5, 160);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_RED);
    tft.print("TOF INVALID");
  }

  // -----------------------------
  // CPR COUNT, RATE, FEEDBACK + SDP810
  // -----------------------------
  tft.fillRect(5, 198, 310, 40, COLOR_BG);
  tft.setTextSize(1);
  tft.setTextColor(COLOR_GREEN);
  tft.setCursor(5, 199);
  tft.print("COUNT: ");
  tft.print(compressionCount);
  tft.print("/30  BREATH: ");
  tft.print(breathCount);
  tft.print("/2");

  tft.setCursor(5, 211);
  tft.setTextColor(COLOR_CYAN);
  tft.print("RATE: ");
  if (compressionRateCPM > 0) tft.print(compressionRateCPM, 0);
  else tft.print("--");
  tft.print(" CPM  ");
  tft.print(rateFeedback);

  tft.setCursor(5, 223);
  tft.setTextColor(COLOR_YELLOW);
  if (ventilationPhase) {
    tft.print("GIVE BREATHS: ");
    tft.print(breathCount);
    tft.print("/2");
  } else {
    tft.print(depthFeedback);
  }
  tft.print("  ");
  if (sdpReady && sdpDataValid) {
    tft.print(sdpPressurePa, 1);
    tft.print("Pa");
  } else {
    tft.print("SDP ERR");
  }
}

// ================================================
// 16. START BUTTON
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

        if (audioReady) {
          dfPlayer.playMp3Folder(START_CPR_TRACK);
          Serial.println("Playing /mp3/0015.mp3 (start_cpr)");
        } else {
          Serial.println("DFPlayer NOT READY");
        }

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
        lastSDP = millis();
      }
    }
  }

  lastButtonReading = reading;
}

// ================================================
// 17. AUDIO SERIAL COMMANDS
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

          if (audioReady && track >= 1 && track <= 26) {

            dfPlayer.playMp3Folder(track);

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
// 18. SETUP
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

  // SPI CHIP-SELECT PINS
  // LCD and MFRC522 share SCK/MOSI/MISO.
  // Keep both devices deselected before starting SPI.
  pinMode(TFT_CS, OUTPUT);
  pinMode(RFID_SS, OUTPUT);
  digitalWrite(TFT_CS, HIGH);
  digitalWrite(RFID_SS, HIGH);

  // I2C: match the known-working standalone SDP810 test sketch
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(100000);
  Wire.setTimeOut(100);

  // SPI (MISO GPIO19 is required by MFRC522)
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
    Serial.print("TOF BASELINE: ");
    Serial.print(TOF_BASELINE_MM, 2);
    Serial.println(" mm (from 3 CSV trials)");

  } else {

    Serial.println("VL53L0X FAILED");
  }

  // -----------------------------
  // RFID
  // -----------------------------

  Serial.println("\n[RFID]");

  // Ensure LCD is not selected while initializing the RFID reader.
  digitalWrite(TFT_CS, HIGH);
  digitalWrite(RFID_SS, HIGH);

  rfid.PCD_Init();
  delay(50);

  // Explicitly enable the RF field and use maximum receiver gain.
  rfid.PCD_AntennaOn();
  rfid.PCD_SetAntennaGain(MFRC522::RxGain_max);
  delay(10);

  // Leave RFID deselected after initialization.
  digitalWrite(RFID_SS, HIGH);
  digitalWrite(TFT_CS, HIGH);

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

  // Re-assert the same stable I2C settings used by the standalone SDP test.
  Wire.setClock(100000);
  Wire.setTimeOut(100);

  Wire.beginTransmission(SDP810_ADDR);

  if (Wire.endTransmission() == 0) {

    Serial.println("SDP810 I2C ACK: OK");
    startSDP810ContinuousMeasurement();

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
  // REDRAW LCD AFTER PERIPHERAL INITIALIZATION
  // -----------------------------
  digitalWrite(RFID_SS, HIGH);
  drawStartScreen();
  digitalWrite(TFT_CS, HIGH);

  // -----------------------------
  // COMPLETE
  // -----------------------------

  Serial.println("\n================================");
  Serial.println("INITIALIZATION COMPLETE");
  Serial.println("Press START button to open dashboard.");
  Serial.println("================================");

  Serial.println("Audio commands:");
  Serial.println("1-26 : Play track (21-22=students, 23-26=CPR prompts)");
  Serial.println("+    : Volume up");
  Serial.println("-    : Volume down");
  Serial.println("S    : Stop");
}

// ================================================
// 19. MAIN LOOP
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
    if (!compressionArmed) finishCompression();
    if (activeStudent == 2) {
      // ST2 completes the final two-minute turn. Stop accumulation and preserve BLE data.
      activeStudent = 0;
      awaitingSwitch = false;
      dashboardActive = false;
      sessionDurationMs = millis() - sessionStartedAt;
      sessionFinished = true;
      playPriorityPrompt(FINISH_VOICE_TRACK, "0019: session complete");
      drawStartScreen();
      Serial.println("ST2 FINISHED - SESSION COMPLETE - BLE GET AVAILABLE");
      Serial.println(buildSessionJSON());
      return;
    }
    compressionArmed = true; compressionCount = 0; breathCount = 0;
    ventilationPhase = false; lastCompressionAt = 0; lastCountedCompressionMs = 0;
    previousStudent = 1;
    switchDueAt = turnStartedAt + TURN_DURATION_MS;
    activeStudent = 0;
    awaitingSwitch = true;
    Serial.println("ST1 FINISHED - SCAN ST2 RFID");
    lastSwitchPromptMs = 0;
    servicePriorityPrompts();
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

  // SDP810 differential pressure measurement
  if (now - lastSDP >= SDP_INTERVAL) {

    lastSDP = now;

    readSDP810();
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

  // Highest-priority repeated guidance (no blocking delays).
  servicePriorityPrompts();
  // Audio commands
  checkAudioCommand();
}