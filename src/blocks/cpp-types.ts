import * as Blockly from 'blockly/core';
import type { Block, Workspace } from 'blockly/core';
import { Order, type ArduinoGenerator } from './arduino-generator';

// C++ types for Blockly's untyped values, shared by the core families (variables, text,
// lists, functions). Pure functions over the workspace; no state.
//
// The variable-typing heuristic (documented in docs/adr/0001-starter-toolbox.md → Typing):
// every Blockly variable becomes one global, declared once in the definitions section. Its
// type comes from everything assigned to it in the workspace:
//   - a list (`lists_create_with`)           → fixed-size array `double name[N]` (N = largest)
//   - any text value, or `text_append` on it → `String`
//   - only true/false values                 → `bool`
//   - anything else, or nothing known        → `double` (the default)
// A value's type comes from the block's output check (`String`, `Boolean`, `Number`); a
// variable read or a function call takes the type of that variable / function, with a cycle
// guard. A function parameter is its own scope: it is typed by the assignments inside that
// function plus the arguments its calls pass, never by the global of the same name.
//
// Pattern: carlosperate/ardublockly's StaticTyping (blockly/generators/arduino.js →
// collectVarsWithTypes) also types variables from their assignments; ours is smaller
// (three scalar types + arrays) and reads Blockly's own output checks instead of a
// per-block getBlockType().

export type ScalarType = 'double' | 'String' | 'bool';

export interface ArrayType {
  element: ScalarType;
  size: number;
}

export type CppType = ScalarType | ArrayType;

export function isArrayType(type: CppType | null): type is ArrayType {
  return typeof type === 'object' && type !== null;
}

/** The scalar a type collapses to where arrays can't go (parameters, return values). */
export function scalarOf(type: CppType | null): ScalarType {
  if (!type) return 'double';
  return isArrayType(type) ? type.element : type;
}

/** Combine the types of several assignments: arrays win, then String, then all-bool, then double. */
export function mergeTypes(types: (CppType | null)[]): CppType | null {
  const known = types.filter((type): type is CppType => type !== null);
  if (!known.length) return null;
  const arrays = known.filter(isArrayType);
  if (arrays.length) {
    return {
      element: scalarOf(mergeTypes(arrays.map((array) => array.element))),
      size: Math.max(...arrays.map((array) => array.size)),
    };
  }
  if (known.includes('String')) return 'String';
  if (known.every((type) => type === 'bool')) return 'bool';
  return 'double';
}

/** Value inputs named `ADD0`, `ADD1`… (text_join, lists_create_with). */
export function itemInputs(block: Block): string[] {
  return block.inputList.map((input) => input.name).filter((name) => /^ADD\d+$/.test(name));
}

function inputBlock(block: Block, name: string): Block | null {
  return block.getInputTargetBlock(name);
}

/**
 * One type query's working state. Every variable / function type is computed once per query
 * (`memo`), so chains like `b = a`, `c = b`… stay linear instead of re-scanning the workspace
 * for each reference. `inProgress` is the cycle guard: a type that depends on itself
 * (`a = b`, `b = a`) contributes nothing on the way round.
 */
interface TypeContext {
  memo: Map<string, CppType | null>;
  inProgress: Set<string>;
  blocks?: Block[];
}

function newContext(): TypeContext {
  return { memo: new Map(), inProgress: new Set() };
}

function memoized(ctx: TypeContext, key: string, compute: () => CppType | null): CppType | null {
  if (ctx.memo.has(key)) return ctx.memo.get(key) ?? null;
  if (ctx.inProgress.has(key)) return null;
  ctx.inProgress.add(key);
  const result = compute();
  ctx.inProgress.delete(key);
  ctx.memo.set(key, result);
  return result;
}

/** The type of the value `block` outputs, or `null` when nothing can be said. */
export function valueType(block: Block | null): CppType | null {
  return typeOf(block, newContext());
}

function typeOf(block: Block | null, ctx: TypeContext): CppType | null {
  if (!block) return null;
  switch (block.type) {
    case 'variables_get': {
      const varId = block.getFieldValue('VAR') as string;
      return assignedType(block.workspace, varId, variableScope(block, varId), ctx);
    }
    case 'procedures_callreturn': {
      const type = returnTypeOf(block.workspace, block.getFieldValue('NAME') as string, ctx);
      return type === 'void' ? null : type;
    }
    case 'lists_create_with': {
      const items = itemInputs(block);
      const element = scalarOf(
        mergeTypes(items.map((name) => scalarOrNull(typeOf(inputBlock(block, name), ctx)))),
      );
      return { element, size: items.length };
    }
    case 'lists_getIndex': {
      const list = typeOf(inputBlock(block, 'VALUE'), ctx);
      return isArrayType(list) ? list.element : null;
    }
    case 'logic_ternary':
      return mergeTypes([
        typeOf(inputBlock(block, 'THEN'), ctx),
        typeOf(inputBlock(block, 'ELSE'), ctx),
      ]);
  }
  const check = block.outputConnection?.getCheck() ?? [];
  if (check.includes('String')) return 'String';
  if (check.includes('Boolean')) return 'bool';
  if (check.includes('Number')) return 'double';
  return null;
}

function scalarOrNull(type: CppType | null): ScalarType | null {
  return type === null || isArrayType(type) ? null : type;
}

/**
 * Where `block`'s use of variable `varId` lives: the function that has it as a parameter, or
 * `null` for the global. A parameter is a separate C++ variable that shadows the global.
 */
export function variableScope(block: Block, varId: string): Block | null {
  const fn = enclosingFunction(block);
  return fn?.getVarModels().some((model) => model.getId() === varId) ? fn : null;
}

/**
 * The C++ type of variable `varId` in `scope` (`null` = the global; a procedures_def* block =
 * its parameter), from every assignment to it in that scope and, for a parameter, every
 * argument passed for it.
 */
export function variableType(
  workspace: Workspace,
  varId: string,
  scope: Block | null = null,
): CppType {
  return assignedType(workspace, varId, scope, newContext()) ?? 'double';
}

/** Declared size of a list variable read by `block`, or `null` if it isn't one. */
export function listVariableSize(block: Block | null): number | null {
  if (block?.type !== 'variables_get') return null;
  const type = valueType(block);
  return isArrayType(type) ? type.size : null;
}

/** Blocks that generate code: disabled blocks and anything inside them are skipped. */
function activeBlocks(workspace: Workspace): Block[] {
  return workspace
    .getAllBlocks(false)
    .filter((block) => block.isEnabled() && !block.getInheritedDisabled());
}

/**
 * Make the sketch fail to compile with `message`, which arduino-cli shows verbatim in the
 * compile log — for block shapes C++ can't express. One entry per `key` (a block id).
 */
export function compileError(generator: ArduinoGenerator, key: string, message: string): void {
  generator.addDefinition(`unsupported:${key}`, `#error ${cppString(message)}`);
}

function assignedType(
  workspace: Workspace,
  varId: string,
  scope: Block | null,
  ctx: TypeContext,
): CppType | null {
  return memoized(ctx, `variable:${varId}:${scope?.id ?? ''}`, () =>
    computeAssignedType(workspace, varId, scope, ctx),
  );
}

function computeAssignedType(
  workspace: Workspace,
  varId: string,
  scope: Block | null,
  ctx: TypeContext,
): CppType | null {
  const assigned: (CppType | null)[] = [];
  ctx.blocks ??= activeBlocks(workspace);
  const blocks = ctx.blocks;
  for (const block of blocks) {
    // `set item` on this list variable: its value joins the element type (size 0 = no size).
    if (block.type === 'lists_setIndex') {
      const list = inputBlock(block, 'LIST');
      if (
        list?.type === 'variables_get' &&
        list.getFieldValue('VAR') === varId &&
        variableScope(list, varId) === scope
      ) {
        const element = scalarOrNull(typeOf(inputBlock(block, 'TO'), ctx));
        if (element) assigned.push({ element, size: 0 });
      }
      continue;
    }
    if (block.getFieldValue('VAR') !== varId || variableScope(block, varId) !== scope) continue;
    switch (block.type) {
      case 'variables_set':
        assigned.push(typeOf(inputBlock(block, 'VALUE'), ctx));
        break;
      case 'text_append':
        assigned.push('String');
        break;
      case 'math_change':
      case 'controls_for':
        assigned.push('double');
        break;
    }
  }
  if (scope) {
    const index = scope.getVarModels().findIndex((model) => model.getId() === varId);
    const name = scope.getFieldValue('NAME') as string;
    for (const call of blocks) {
      const isCall =
        call.type === 'procedures_callnoreturn' || call.type === 'procedures_callreturn';
      if (isCall && Blockly.Names.equals(call.getFieldValue('NAME') as string, name)) {
        assigned.push(typeOf(inputBlock(call, `ARG${index}`), ctx));
      }
    }
  }
  return mergeTypes(assigned);
}

/** Return type of the function named `name` (`void` for one with no return value). */
export function functionReturnType(workspace: Workspace, name: string): ScalarType | 'void' {
  return returnTypeOf(workspace, name, newContext());
}

function returnTypeOf(workspace: Workspace, name: string, ctx: TypeContext): ScalarType | 'void' {
  const def = Blockly.Procedures.getDefinition(name, workspace);
  if (!def || def.type !== 'procedures_defreturn') return 'void';
  const merged = memoized(ctx, `function:${def.id}`, () => {
    const returned: (CppType | null)[] = [typeOf(inputBlock(def, 'RETURN'), ctx)];
    for (const block of def.getDescendants(false)) {
      if (
        block.type === 'procedures_ifreturn' &&
        enclosingFunction(block) === def &&
        block.isEnabled() &&
        !block.getInheritedDisabled()
      ) {
        returned.push(typeOf(inputBlock(block, 'VALUE'), ctx));
      }
    }
    return mergeTypes(returned);
  });
  // Arrays can't be returned by value in C++; such a function returns its element type.
  return scalarOf(merged);
}

/** The procedure definition a block sits in, or `null` for top-level code. */
export function enclosingFunction(block: Block): Block | null {
  const root = block.getRootBlock();
  return root.type === 'procedures_defnoreturn' || root.type === 'procedures_defreturn'
    ? root
    : null;
}

/** A literal of `type` for an empty input. */
export function defaultValue(type: ScalarType): string {
  switch (type) {
    case 'String':
      return 'String("")';
    case 'bool':
      return 'false';
    default:
      return '0';
  }
}

/**
 * Input `name` of `block` as a value of type `type` (its default when empty). Only `String`
 * needs a conversion: Arduino's `String(int)` constructor is explicit, so `s = 5` won't compile.
 */
export function typedInput(
  block: Block,
  generator: ArduinoGenerator,
  name: string,
  type: ScalarType,
  order: Order,
): string {
  if (type === 'String') return stringInput(block, generator, name, order) ?? '""';
  return generator.valueToCode(block, name, order) || defaultValue(type);
}

/**
 * Input `name` of `block` as an Arduino String, or `null` when it's empty. Non-text values
 * get `String(…)`. With `object`, a text literal is wrapped too: left of `+`, `==` or `.`
 * a bare `"…"` is a `const char*` (`"a" + "b"` adds pointers, `"a" == "b"` compares them).
 * `order` is the binding the caller needs for a value that isn't wrapped.
 */
export function stringInput(
  block: Block,
  generator: ArduinoGenerator,
  name: string,
  order: Order,
  object = false,
): string | null {
  const child = block.getInputTargetBlock(name);
  if (!child) return null;
  // A ternary over two literals is a `const char*` too.
  const literal = child.type === 'text' || child.type === 'logic_ternary';
  const usable = valueType(child) === 'String' && !(object && literal);
  const code = generator.valueToCode(block, name, usable ? order : Order.NONE);
  if (!code) return null;
  return usable ? code : `String(${code})`;
}

/** A C++ string literal: `"…"` with `\`, `"`, and control characters escaped. UTF-8 stays as is. */
export function cppString(text: string): string {
  const escaped = text.replace(/[\\"\n\r\t]/g, (char) => {
    switch (char) {
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        return `\\${char}`;
    }
  });
  return `"${escaped}"`;
}

function declaration(type: CppType, name: string): string {
  // A zero-length array isn't standard C++; list blocks flag an empty list (lists.ts).
  if (isArrayType(type)) return `${type.element} ${name}[${Math.max(type.size, 1)}];`;
  return `${type} ${name} = ${type === 'String' ? '""' : defaultValue(type)};`;
}

/**
 * The C++ name of the variable `varId` as used by `block`, declaring it as a global in the
 * definitions section unless `block` is inside a function that has it as a parameter (the
 * parameter shadows the global, as in Blockly).
 */
export function variableRef(block: Block, generator: ArduinoGenerator, varId: string): string {
  const name = generator.getVariableName(varId);
  if (variableScope(block, varId)) return name;
  generator.addDefinition(
    `variable:${name}`,
    declaration(variableType(block.workspace, varId), name),
  );
  return name;
}
