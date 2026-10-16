# ADR 0001 — Starter toolbox by default, full toolbox on request

Status: accepted (B3, issue #6) · Date: 2026-10-16

## Context

Students are 10–14 and most start in their first class. Blockly's core families ship dozens of
blocks — trigonometry, logarithms, list surgery, `break`/`continue`, raw C++ — and a long
toolbox buries the ten blocks a first program needs. `_config/i18n.md` already sets the rule:
no jargon on the starter toolbox, technical terms allowed in the full one. Teachers and
advanced students still need the rest, and a block can't be hidden from one audience without
some notion of "which toolbox".

Arduino C++ is also typed while Blockly's variables are not, so every core family needs one
shared typing rule (below); it decides what the starter blocks can safely produce.

## Decision

1. **Two toolbox profiles: `starter` (default) and `full`.** A family marks a toolbox block or
   a whole category `fullOnly: true`; `buildToolbox(profile)` drops those for `starter` (and
   drops a static category left empty). The family contract stays one module per family; the
   profile is data on its toolbox, not a second toolbox.

   | Category | Starter | Full adds |
   |---|---|---|
   | Lógica / Logic | if, if-else, compare, and/or, not, true/false | ternary `? :` |
   | Control | repeat N, while/until, count with | break / continue |
   | Matemáticas / Math | number, + − × ÷ ^, random integer, map (`som_math_map`), constrain | √/abs/−/ln/log10/eˣ/10ˣ, sin/cos/tan…, even/odd/prime…, round, remainder, random fraction |
   | Texto / Text | text, join | length, is empty, append, find |
   | Variables | Blockly's dynamic variables category | — |
   | Listas / Lists | — | create list, length, get/set item (category is full-only) |
   | Funciones / Functions | Blockly's dynamic procedures category | — |
   | Código / Code (raw C++) | — | whole category |

2. **How a user gets `full` in v1:** the URL parameter `?toolbox=full` (like `?lang=`). A real
   switch in the UI waits until the teacher view exists (B12 or later); no screen is built for
   it now (`_config/agentic-practices.md` §5).

3. **Typing.** Every Blockly variable is one global declared once in the definitions section.
   Its type is the merge of everything assigned to it: a list → a fixed-size array; any text
   (or `append text`) → `String`; only true/false → `bool`; otherwise `double`, the default.
   A function parameter is its own scope (assignments inside that function plus the arguments
   its calls pass) and shadows a global of the same name, as in Blockly. Implementation and
   tests: `src/blocks/cpp-types.ts`, `src/blocks/cpp-types.test.ts`.

## Consequences

- The starter toolbox is short enough for a first class; nothing is removed from the editor,
  so a starter project opened with `?toolbox=full` keeps working, and vice versa: a project
  using a full-only block still loads and generates code in the starter toolbox (the block is
  just not offered in the flyout).
- `double` by default means `7 / 2` is `3.5` like Blockly, at the cost of float arithmetic on
  AVR. Arduino calls that take integers (`map`, `random`) convert implicitly.
- Lists are a deliberately small subset (fixed-size arrays, no insert/remove); unsupported
  list blocks fail the compile with an `#error` message in the student's language rather than
  generating code that silently behaves differently.
- Changing a block's profile is a one-line data change in its family; any later profile
  (e.g. per-course toolboxes) extends `ToolboxProfile` and the filter, not every family.
