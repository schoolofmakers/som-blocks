#include <WiFi.h>

// Joins a WiFi network, waiting at most timeoutMs. Already connected: returns at once.
bool somWifiConnect(const char *ssid, const char *pass, unsigned long timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.begin(ssid, pass);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

void setup() {
  WiFi.mode(WIFI_STA);
  Serial.begin(115200);
}

void loop() {
  somWifiConnect("SoM-Aula", "maker\"2026", 15000);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(WiFi.localIP().toString());
    Serial.println(WiFi.RSSI());
  }
  delay(1000);
  WiFi.disconnect();
}
