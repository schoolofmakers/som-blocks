// The USB-CDC `Serial` port is shared by three writers in three tasks: Improv frames (loop),
// log lines (all tasks) and text typed in the editor's monitor (bridge task). Console owns the
// port so their bytes never interleave, and decides what is mirrored to the relay.
#pragma once

#include <Arduino.h>

namespace som {
namespace console {

void begin();

// A log line: written to USB and mirrored to the relay's serial stream.
void log(const char *fmt, ...) __attribute__((format(printf, 1, 2)));

// A line that must stay on the cable (the provisioned URL carries the pairing token).
void localOnly(const String &line);

// Raw bytes (Improv frames). Preceded by '\n' so an Improv client that is skipping an
// ordinary text line resynchronises before the frame header.
void writeFrame(const uint8_t *data, size_t length);

// A line from the relay's `input` endpoint, written to USB as-is.
void writeInput(const String &line);

}  // namespace console
}  // namespace som
