void parpadear();
void delay2(double x);
double total = 0;
void parpadear() {
  delay2(total);
}
String x = "";
String saludo(double nombre);
void delay2(double x) {
  if (x < 0) {
    return;
  }
  total += x;
}
String saludo(double nombre) {
  if (String(nombre).length() == 0) {
    return "hola";
  }
  return String("hola ") + String(nombre);
}

void setup() {
}

void loop() {
  parpadear();
  x = saludo(7);
}
