double brillo = 0;
double valor = 0;
double dado = 0;
double mitad = 0;
bool isPrime(double n) {
  if (n < 2 || n != floor(n)) return false;
  if (n == 2 || n == 3) return true;
  if (fmod(n, 2) == 0 || fmod(n, 3) == 0) return false;
  for (long i = 6; (double)(i - 1) * (i - 1) <= n; i += 6) {
    if (fmod(n, i - 1) == 0 || fmod(n, i + 1) == 0) return false;
  }
  return true;
}
double x = 0;

void setup() {
}

void loop() {
  brillo = map(valor, 0, 1023, 0, 255);
  brillo += 1;
  dado = random(1, 7);
  mitad = 7 / 2.0;
  if (isPrime(dado)) {
    x = constrain(-(-1), sin(30 * DEG_TO_RAD), fmod(ceil(3.5), 2));
  }
}
