void setup() {
  Serial.begin(9600);
}

void loop() {
  Serial.print("Hola");
  Serial.println(Serial.readStringUntil('\n'));
}
