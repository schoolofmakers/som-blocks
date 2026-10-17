String l[2];
double n = 0;
double m = 0;
long randomInt(double a, double b) {
  if (a > b) {
    double t = a;
    a = b;
    b = t;
  }
  return random((long)a, (long)b + 1);
}
String s = "";

void setup() {
}

void loop() {
  l[0] = String(1);
  l[1] = String(2);
  l[0] = "hola";
  n = randomInt(m, 1);
  double count_times = n;
  for (long count = 0; count < count_times; count++) {
    s = fabs(fmod(n, 2)) == 1 ? String("impar") : String(300.0 * 300);
  }
}
