// Serial bridge between the relay and the USB-CDC port:
//   board → relay: log lines and text received on USB (not Improv frames) are queued and sent
//                  as `POST /serial` batches (≤ 50 lines / 8 kB, at most one per 500 ms);
//   relay → board: `GET /input?wait=` lines are written to USB.
// Runs in its own FreeRTOS task because the input long poll blocks for up to 25 s.
#pragma once

#include <Arduino.h>

#include <string>

namespace som {
namespace bridge {

void begin();      // creates the queue; call before anything logs
void startTask();  // starts the network task
void enqueue(const std::string &line);

}  // namespace bridge
}  // namespace som
