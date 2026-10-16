static unsigned long som_every = 0;
static unsigned long som_every2 = 0;

void setup() {
  Serial.begin(115200);
  pinMode(13, OUTPUT);
}

void loop() {
  if (millis() - som_every >= 1000) {
    som_every = millis();
    Serial.println(millis());
  }
  if (millis() - som_every2 >= 250) {
    som_every2 = millis();
    digitalWrite(13, HIGH);
  }
}
