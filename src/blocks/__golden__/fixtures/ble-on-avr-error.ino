#error "Bluetooth necesita una placa ESP32, como la ESP32-C3. Elígela en el selector de placa."

void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  // ERROR
  // ERROR
  if (false) {
    digitalWrite(13, HIGH);
  }
}
