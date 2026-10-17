void setup() {
}

void loop() {
  if (1 < 2 && !false) {
    tone(8, 262);
  } else if (String("hola") == "chao") {
    tone(8, 294);
  } else {
    noTone(8);
  }
  if (true || false) {
    delay(10);
  }
}
