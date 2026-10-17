String mensaje = "";
double n = 0;
double posici_C3_B3n = 0;

void setup() {
}

void loop() {
  mensaje = String("Hola \"maker\" ") + String(42) + "!";
  mensaje += String(n);
  n = mensaje.length();
  if (String("").length() == 0) {
    posici_C3_B3n = mensaje.lastIndexOf("a") + 1;
  }
}
