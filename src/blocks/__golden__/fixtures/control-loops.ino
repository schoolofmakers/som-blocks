double i = 0;
double count = 0;

void setup() {
}

void loop() {
  for (long count2 = 0; count2 < 3; count2++) {
    for (long count3 = 0; count3 < 2; count3++) {
      delay(100);
    }
  }
  for (i = 10; i >= 1; i -= 3) {
    continue;
  }
  double i_start = 1;
  double i_end = count;
  double i_inc = fabs(1);
  if (i_start > i_end) i_inc = -i_inc;
  for (i = i_start; i_inc >= 0 ? i <= i_end : i >= i_end; i += i_inc) {
  }
  while (!(i > 5)) {
    break;
  }
}
