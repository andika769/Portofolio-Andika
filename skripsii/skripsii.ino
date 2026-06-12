#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <Adafruit_MLX90640.h>
#include <LittleFS.h>
#include <Wire.h>

const char* ssid = "";
const char* password = "113333555555";

IPAddress local_IP(10,220,195,161);
IPAddress gateway(10,220,195,141);
IPAddress subnet(255,255,255,0);

// ================= SERVER =================
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ================= MLX90640 =================
Adafruit_MLX90640 mlx;
float frame[32 * 24];

// ================= TIMER =================
unsigned long lastSend = 0;
unsigned long lastSerialPrint = 0;

// ================= INTERVAL =================
const uint16_t frameInterval = 100;          // web update (ms)
const unsigned long serialInterval = 10000; // 10 detik

// ================= KALIBRASI =================
const float TEMP_OFFSET = 0;

// =====================================================
// WEBSOCKET EVENT
// =====================================================
void onWebSocketEvent(AsyncWebSocket *server,
                      AsyncWebSocketClient *client,
                      AwsEventType type,
                      void *arg,
                      uint8_t *data,
                      size_t len) {

  if (type == WS_EVT_CONNECT) {
    Serial.println("Client connected");
  }

  else if (type == WS_EVT_DISCONNECT) {
    Serial.println("Client disconnected");
  }
}

// =====================================================
// APPLY CALIBRATION
// =====================================================
void applyCalibration(float *data, size_t len, float offset) {

  for (size_t i = 0; i < len; i++) {
    data[i] += offset;
  }
}

// =====================================================
// SETUP
// =====================================================
void setup() {

  // ================= SERIAL =================
  Serial.begin(921600);
  delay(1000);

  // ================= I2C =================
  Wire.begin(21, 22);

  // lebih stabil untuk MLX90640
  Wire.setClock(400000);

  delay(200);

  // ================= MLX90640 =================
  if (!mlx.begin(0x33, &Wire)) {

    Serial.println("MLX90640 not found!");

    while (1);
  }

  mlx.setMode(MLX90640_CHESS);
  mlx.setResolution(MLX90640_ADC_16BIT);
  mlx.setRefreshRate(MLX90640_8_HZ);

  Serial.println("MLX90640 Ready");

  // ================= LITTLEFS =================
  if (!LittleFS.begin()) {

    Serial.println("LittleFS Mount Failed");

    while (1);
  }

  // ================= WIFI =================
  WiFi.mode(WIFI_STA);

  WiFi.begin(ssid, password);

  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi Connected");

  Serial.print("IP Address : ");
  Serial.println(WiFi.localIP());

  Serial.print("Gateway    : ");
  Serial.println(WiFi.gatewayIP());

  Serial.print("Subnet     : ");
  Serial.println(WiFi.subnetMask());

  // ================= WEBSOCKET =================
  ws.onEvent(onWebSocketEvent);

  server.addHandler(&ws);

  // ================= WEB PAGE =================
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {

    request->send(LittleFS, "/index.html", "text/html");
  });

  server.serveStatic("/", LittleFS, "/");

  // ================= START SERVER =================
  server.begin();

  Serial.println("Server started");
}

// =====================================================
// LOOP
// =====================================================
void loop() {

  // cleanup websocket client
  ws.cleanupClients();

  // ================= BACA FRAME =================
  int status = mlx.getFrame(frame);

  // ================= FRAME BERHASIL =================
  if (status == 0) {

    // kalibrasi offset
    applyCalibration(frame, 32 * 24, TEMP_OFFSET);

    // =================================================
    // KIRIM KE WEB
    // =================================================
    if (millis() - lastSend >= frameInterval) {

      if (ws.count() > 0) {

        ws.binaryAll((uint8_t*)frame, sizeof(frame));
      }

      lastSend = millis();
    }

    // =================================================
    // SERIAL RAW DATA
    // =================================================
    if (millis() - lastSerialPrint >= serialInterval) {

      for (int i = 0; i < 32 * 24; i++) {

        Serial.print(frame[i], 2);

        if (i < (32 * 24) - 1) {
          Serial.print(",");
        }
      }

      Serial.println();

      lastSerialPrint = millis();
    }
  }

  // ================= ERROR =================
  else {

    Serial.print("MLX read error: ");
    Serial.println(status);
  }
}