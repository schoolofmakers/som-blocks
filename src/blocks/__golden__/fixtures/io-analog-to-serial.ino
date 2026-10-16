void setup() {
  Serial.begin(115200);
  pinMode(9, OUTPUT);
}

void loop() {
  Serial.println(analogRead(A0));
  Serial.print("luz:");
  Serial.println(analogRead(A1));
  analogWrite(9, 128);
  delay(100);
}
