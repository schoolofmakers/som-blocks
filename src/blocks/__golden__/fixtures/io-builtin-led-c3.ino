void setup() {
  pinMode(8, OUTPUT);
}

void loop() {
  digitalWrite(8, LOW);
  delay((unsigned long)(0.5 * 1000));
  digitalWrite(8, HIGH);
  delay((unsigned long)(0.5 * 1000));
}
