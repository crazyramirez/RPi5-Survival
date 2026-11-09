// Survival OS — nodo ESP32 de ejemplo (protocolo serie JSON Lines v1, 115200 8N1).
//
// ESTADO: NO PROBADO EN HARDWARE. Plantilla para JC3248W535 / JC4827W543 (ESP32-S3, USB nativo)
// y JC2432W328 (ESP32 + CH340). Compilar con Arduino IDE / arduino-cli, core "esp32" de Espressif.
// En ESP32-S3: Tools → USB CDC On Boot → Enabled (para que Serial use el USB nativo, 303a:1001).
//
// Envía:  hello al arrancar, heartbeat cada 10 s (temperatura interna aproximada, memoria, uptime),
//         event al pulsar el botón BOOT (GPIO0). Responde "ack" a {"v":1,"type":"ping"}.
// No incluye LoRa: un ESP32 sin módulo SX126x/SX127x no transmite LoRa.

#include <Arduino.h>

static const char *DEVICE_ID = "esp32-nodo-1";   // cámbialo por placa (máx. 64, [A-Za-z0-9_.-])
static const char *FIRMWARE = "survival-node 0.1.0";
static const int BUTTON_PIN = 0;                  // BOOT
static const uint32_t HEARTBEAT_MS = 10000;

static uint32_t lastBeat = 0;
static bool lastButton = true;
static String rx;

static void sendLine(const char *type, const String &payload) {
  Serial.print("{\"v\":1,\"type\":\"");
  Serial.print(type);
  Serial.print("\",\"device\":\"");
  Serial.print(DEVICE_ID);
  Serial.print("\",\"ts\":");
  Serial.print(millis());
  Serial.print(",\"payload\":");
  Serial.print(payload);
  Serial.print("}\n");
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  delay(500);
  sendLine("hello", String("{\"firmware\":\"") + FIRMWARE + "\",\"chip\":\"" + ESP.getChipModel() + "\"}");
}

void loop() {
  uint32_t now = millis();
  if (now - lastBeat >= HEARTBEAT_MS) {
    lastBeat = now;
    // temperatureRead(): sensor interno del chip, impreciso (±5 °C); NO es temperatura ambiente.
    String p = "{\"readings\":[";
    p += "{\"sensor\":\"chip_temp\",\"value\":" + String(temperatureRead(), 1) + ",\"unit\":\"°C\"},";
    p += "{\"sensor\":\"heap_free\",\"value\":" + String(ESP.getFreeHeap()) + ",\"unit\":\"B\"},";
    p += "{\"sensor\":\"uptime\",\"value\":" + String(now / 1000) + ",\"unit\":\"s\"}";
    p += "]}";
    sendLine("heartbeat", p);
  }

  bool b = digitalRead(BUTTON_PIN);
  if (lastButton && !b) sendLine("event", "{\"event\":\"button\",\"id\":\"BOOT\",\"action\":\"press\"}");
  lastButton = b;

  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      if (rx.indexOf("\"type\":\"ping\"") >= 0) sendLine("ack", "{\"to\":\"ping\"}");
      rx = "";
    } else if (rx.length() < 512) {
      rx += c;
    }
  }
  delay(20);
}
