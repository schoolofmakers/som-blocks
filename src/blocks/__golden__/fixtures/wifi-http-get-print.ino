#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

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
// HTTP(S) request: the response body, or "" on any error (no WiFi, timeout, not 2xx).
// https:// does not check the certificate (setInsecure): encrypted, not authenticated.
String somHttpRequest(const String &url, const char *contentType, const String &body, bool post) {
  if (WiFi.status() != WL_CONNECTED) return "";
  WiFiClient plain;
  WiFiClientSecure secure;
  secure.setInsecure();
  WiFiClient &client = url.startsWith("https://") ? secure : plain;
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if (!http.begin(client, url)) return "";
  int code;
  if (post) {
    http.addHeader("Content-Type", contentType);
    code = http.POST(body);
  } else {
    code = http.GET();
  }
  String result = (code >= 200 && code < 300) ? http.getString() : String("");
  http.end();
  return result;
}
String somHttpGet(const String &url) {
  return somHttpRequest(url, "", "", false);
}
String somHttpPost(const String &url, const String &body, const char *contentType) {
  return somHttpRequest(url, contentType, body, true);
}

void setup() {
  WiFi.mode(WIFI_STA);
  Serial.begin(115200);
}

void loop() {
  somWifiConnect("SoM-Aula", "maker2026", 15000);
  Serial.println(somHttpGet("https://example.com/hola.txt"));
  Serial.println(somHttpPost("http://example.com/datos", "{\"luz\": 1}", "application/json"));
}
