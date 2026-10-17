import * as Blockly from 'blockly/core';

// Arduino C++ generator for Blockly 13.
// Pattern: google/blockly packages/blockly/generators/dart/dart_generator.ts (a class that
// extends CodeGenerator, overriding init / finish / scrub_ / scrubNakedValue), with the
// separate includes / definitions / setups dictionaries of carlosperate/ardublockly
// blockly/generators/arduino.js. Written from scratch; nothing copied.

/**
 * Operator precedence for value blocks, mirroring C++ (lower binds tighter).
 * https://en.cppreference.com/w/cpp/language/operator_precedence
 */
export const Order = {
  ATOMIC: 0, // literals, identifiers, (...)
  POSTFIX: 1, // expr++ expr-- f() a[] . ->
  UNARY_PREFIX: 2, // ++expr --expr -expr !expr ~expr (type) *p &x sizeof
  MULTIPLICATIVE: 3, // * / %
  ADDITIVE: 4, // + -
  SHIFT: 5, // << >>
  RELATIONAL: 6, // < <= > >=
  EQUALITY: 7, // == !=
  BITWISE_AND: 8, // &
  BITWISE_XOR: 9, // ^
  BITWISE_OR: 10, // |
  LOGICAL_AND: 11, // &&
  LOGICAL_OR: 12, // ||
  CONDITIONAL: 13, // expr ? expr : expr
  ASSIGNMENT: 14, // = += -= *= /= %= <<= >>= &= ^= |=
  COMMA: 15, // ,
  NONE: 99, // (...)
} as const;

export type Order = (typeof Order)[keyof typeof Order];

/**
 * Identifiers a student's variable or function may not take: C++ keywords, the sketch entry
 * points, and the Arduino core API our generators call. `nameDB_` renames a clash (`map` →
 * `map2`). Arduino list after carlosperate/ardublockly blockly/generators/arduino.js.
 */
export const RESERVED_WORDS: readonly string[] = [
  // C++ keywords and literals
  'alignas,alignof,and,and_eq,asm,auto,bitand,bitor,bool,break,case,catch,char,char16_t',
  'char32_t,class,compl,const,constexpr,const_cast,continue,decltype,default,delete,do',
  'double,dynamic_cast,else,enum,explicit,export,extern,false,float,for,friend,goto,if',
  'inline,int,long,mutable,namespace,new,noexcept,not,not_eq,nullptr,operator,or,or_eq',
  'private,protected,public,register,reinterpret_cast,return,short,signed,sizeof,static',
  'static_assert,static_cast,struct,switch,template,this,thread_local,throw,true,try',
  'typedef,typeid,typename,union,unsigned,using,virtual,void,volatile,wchar_t,while,xor',
  'xor_eq,NULL',
  // Sketch entry points and Arduino types / constants
  'setup,loop,main,boolean,byte,word,String,size_t,uint8_t,int8_t,uint16_t,int16_t',
  'uint32_t,int32_t,uint64_t,int64_t,HIGH,LOW,INPUT,OUTPUT,INPUT_PULLUP,LED_BUILTIN,PI',
  'HALF_PI,TWO_PI,DEG_TO_RAD,RAD_TO_DEG,EULER,NAN,INFINITY,Serial,Wire,SPI',
  // Arduino core functions and the C math functions our generators emit
  'pinMode,digitalWrite,digitalRead,analogReference,analogRead,analogWrite,tone,noTone',
  'shiftOut,shiftIn,pulseIn,millis,micros,delay,delayMicroseconds,min,max,abs,constrain',
  'map,pow,sqrt,sq,sin,cos,tan,asin,acos,atan,atan2,exp,log,log10,fabs,fmod,floor,ceil',
  'round,random,randomSeed,lowByte,highByte,bitRead,bitWrite,bitSet,bitClear,bit',
  'attachInterrupt,detachInterrupt,interrupts,noInterrupts,yield',
  // ESP32 WiFi globals / classes and the wifi family's helpers (families/wifi.ts)
  'WiFi,WiFiClient,WiFiClientSecure,HTTPClient,somWifiConnect,somHttpRequest,somHttpGet',
  'somHttpPost,WL_CONNECTED,WIFI_STA,HTTPC_STRICT_FOLLOW_REDIRECTS',
].flatMap((line) => line.split(','));

/**
 * Normalise a header to a full `#include` line. Accepts `Wire.h`, `<Wire.h>`, `"my.h"` or
 * `#include <Wire.h>`; returns `null` for an empty header.
 */
export function toIncludeLine(header: string): string | null {
  const bare = header
    .trim()
    .replace(/^#\s*include\s*/, '')
    .trim();
  if (!bare) return null;
  const quoted = /^<.*>$/.test(bare) || /^".*"$/.test(bare);
  return `#include ${quoted ? bare : `<${bare}>`}`;
}

export class ArduinoGenerator extends Blockly.CodeGenerator {
  // Sections collected while blocks generate. Maps/Sets keep insertion order, so the sketch
  // lists entries in the order blocks asked for them (top-to-bottom workspace order).
  private includes = new Set<string>();
  private definitions = new Map<string, string>();
  private setups = new Map<string, string>();

  constructor(name = 'Arduino') {
    super(name);
    this.INDENT = '  ';
    this.isInitialized = false;
    this.addReservedWords(RESERVED_WORDS.join(','));
  }

  /** Add an `#include` (deduplicated). See {@link toIncludeLine} for accepted forms. */
  addInclude(header: string): void {
    const line = toIncludeLine(header);
    if (line) this.includes.add(line);
  }

  /** Add a top-level definition (global, function…). Same key = replaced in place. */
  addDefinition(key: string, code: string): void {
    this.definitions.set(key, code.replace(/\n+$/, ''));
  }

  /** Add a line (or lines) to `setup()`. Same key = replaced in place, order kept. */
  addSetup(key: string, code: string): void {
    this.setups.set(key, code.replace(/\n+$/, ''));
  }

  override init(workspace: Blockly.Workspace): void {
    super.init(workspace);
    this.includes = new Set();
    this.definitions = new Map();
    this.setups = new Map();
    if (this.nameDB_) {
      this.nameDB_.reset();
    } else {
      this.nameDB_ = new Blockly.Names(this.RESERVED_WORDS_);
    }
    this.nameDB_.setVariableMap(workspace.getVariableMap());
    // Claim the student's variable and function names first, so helper names made with
    // getDistinctName (loop counters…) are the ones that get a suffix, never theirs.
    this.nameDB_.populateVariables(workspace);
    this.nameDB_.populateProcedures(workspace);
    this.isInitialized = true;
  }

  /** Assemble the sketch: includes, definitions, `setup()`, then `loop()` with `code`. */
  override finish(code: string): string {
    const parts: string[] = [];
    if (this.includes.size) parts.push([...this.includes].join('\n'));
    if (this.definitions.size) parts.push([...this.definitions.values()].join('\n'));

    const setupBody = [...this.setups.values()].map((s) => this.prefixLines(s, this.INDENT));
    parts.push(['void setup() {', ...setupBody, '}'].join('\n'));

    const loopBody = code ? this.prefixLines(code.replace(/\n+$/, ''), this.INDENT) : '';
    parts.push(['void loop() {', ...(loopBody ? [loopBody] : []), '}'].join('\n'));

    // Base finish clears definitions_ / functionNames_ and the name database.
    super.finish('');
    this.isInitialized = false;
    return parts.join('\n\n') + '\n';
  }

  /** A value block left unplugged at the top level still has to be a legal statement. */
  override scrubNakedValue(line: string): string {
    return `${line};\n`;
  }

  /**
   * Prepend the block's comment (and comments on its value inputs) as `//` lines, then
   * append the code of the next block in the stack.
   */
  override scrub_(block: Blockly.Block, code: string, thisOnly = false): string {
    let commentCode = '';
    if (!block.outputConnection?.targetConnection) {
      const comment = block.getCommentText();
      if (comment) {
        commentCode += this.prefixLines(
          `${Blockly.utils.string.wrap(comment, this.COMMENT_WRAP - 3)}\n`,
          '// ',
        );
      }
      for (const input of block.inputList) {
        if (input.type !== Blockly.inputs.inputTypes.VALUE) continue;
        const child = input.connection?.targetBlock();
        if (!child) continue;
        const nested = this.allNestedComments(child);
        if (nested) commentCode += this.prefixLines(nested, '// ');
      }
    }
    const next = block.nextConnection?.targetBlock() ?? null;
    const nextCode = thisOnly ? '' : this.blockToCode(next);
    return commentCode + code + (typeof nextCode === 'string' ? nextCode : nextCode[0]);
  }
}

/** The one generator the editor and the golden tests share. */
export const arduinoGenerator = new ArduinoGenerator();
