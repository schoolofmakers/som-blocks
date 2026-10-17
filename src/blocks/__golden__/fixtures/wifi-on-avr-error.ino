#error "Los bloques WiFi solo funcionan en una placa ESP32. Elige la ESP32-C3 en \"Placa\"."

void setup() {
  Serial.begin(115200);
}

void loop() {
  // ERROR: Los bloques WiFi solo funcionan en una placa ESP32. Elige la ESP32-C3 en "Placa".
  Serial.println(/* ERROR: Los bloques WiFi solo funcionan en una placa ESP32. Elige la ESP32-C3 en "Placa". */ String(""));
}
