import 'blockly/blocks';
import * as Blockly from 'blockly/core';
import type { Block } from 'blockly/core';
import { Order, type ArduinoGenerator } from '../arduino-generator';
import {
  enclosingFunction,
  functionReturnType,
  scalarOf,
  typedInput,
  variableType,
  type ScalarType,
} from '../cpp-types';
import type { BlockFamily, BlockGenerator } from '../types';

// `functions` family: Blockly's procedure blocks as C++ functions. Every function gets a
// prototype in the definitions section — added by its definition and by every call, so the
// prototype always lands before any function body that calls it, whatever order the blocks
// sit on the workspace. Return and parameter types follow the variable-typing heuristic in
// cpp-types.ts (double unless text or true/false flows into them). Function and parameter
// names come from nameDB_, so a function called `setup` or `delay` is renamed, and a
// parameter shadows a global variable of the same name exactly as in Blockly.
// Pattern: google/blockly generators/javascript/procedures.ts (getVarModels for parameters,
// scrub_ for the comment) and BlocklyDuino/BlocklyDuino
// blockly/generators/arduino/procedures.js (definitions_ instead of inline code); unlike
// BlocklyDuino we type parameters and returns instead of hard-coding `int`.

/** `<type> name(<type> a, …)` for a procedures_def* block. */
function signature(def: Block, generator: ArduinoGenerator): string {
  const name = generator.getProcedureName(def.getFieldValue('NAME') as string);
  const returns =
    def.type === 'procedures_defreturn'
      ? functionReturnType(def.workspace, def.getFieldValue('NAME') as string)
      : 'void';
  const params = def
    .getVarModels()
    .map(
      (model) =>
        `${scalarOf(variableType(def.workspace, model.getId(), def))} ${generator.getVariableName(model.getId())}`,
    );
  return `${returns} ${name}(${params.join(', ')})`;
}

/** Return type of a procedures_defreturn block. */
function returnScalar(def: Block): ScalarType {
  const type = functionReturnType(def.workspace, def.getFieldValue('NAME') as string);
  return type === 'void' ? 'double' : type;
}

function declarePrototype(def: Block, generator: ArduinoGenerator): void {
  const name = generator.getProcedureName(def.getFieldValue('NAME') as string);
  // Same key from the definition and from calls: the first one fixes its position.
  generator.addDefinition(`function-prototype:${name}`, `${signature(def, generator)};`);
}

const defineFunction: BlockGenerator = (block, generator) => {
  declarePrototype(block, generator);
  const name = generator.getProcedureName(block.getFieldValue('NAME') as string);
  const body = generator.statementToCode(block, 'STACK');
  let ret = '';
  if (block.getInput('RETURN')) {
    const type = returnScalar(block);
    ret = `${generator.INDENT}return ${typedInput(block, generator, 'RETURN', type, Order.NONE)};\n`;
  }
  // Generating the body first means any global it uses is declared before the function.
  const code = generator.scrub_(block, `${signature(block, generator)} {\n${body}${ret}}`);
  generator.addDefinition(`function:${name}`, code);
  return null;
};

/** `name(arg, …)`, declaring the callee's prototype. */
function callCode(block: Block, generator: ArduinoGenerator): string {
  const rawName = block.getFieldValue('NAME') as string;
  const name = generator.getProcedureName(rawName);
  const def = Blockly.Procedures.getDefinition(rawName, block.workspace);
  if (def) declarePrototype(def, generator);
  const params = def?.getVarModels() ?? [];
  const args = params.map((model, i) =>
    typedInput(
      block,
      generator,
      `ARG${i}`,
      scalarOf(variableType(block.workspace, model.getId(), def)),
      Order.NONE,
    ),
  );
  return `${name}(${args.join(', ')})`;
}

export const functionsFamily: BlockFamily = {
  id: 'functions',
  blocks: [],
  externalBlocks: [
    'procedures_defnoreturn',
    'procedures_defreturn',
    'procedures_callnoreturn',
    'procedures_callreturn',
    'procedures_ifreturn',
  ],
  generators: {
    procedures_defnoreturn: defineFunction,
    procedures_defreturn: defineFunction,
    procedures_callnoreturn: (block, generator) => `${callCode(block, generator)};\n`,
    procedures_callreturn: (block, generator) => [callCode(block, generator), Order.POSTFIX],
    procedures_ifreturn: (block, generator) => {
      const condition = generator.valueToCode(block, 'CONDITION', Order.NONE) || 'false';
      const def = enclosingFunction(block);
      let ret = 'return;';
      if (def?.type === 'procedures_defreturn') {
        const type = returnScalar(def);
        ret = `return ${typedInput(block, generator, 'VALUE', type, Order.NONE)};`;
      }
      return `if (${condition}) {\n${generator.INDENT}${ret}\n}\n`;
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_FUNCTIONS_CATEGORY}',
    colour: '%{BKY_PROCEDURES_HUE}',
    custom: 'PROCEDURE',
    contents: [],
  },
  messages: {
    es: { SOM_FUNCTIONS_CATEGORY: 'Funciones' },
    en: { SOM_FUNCTIONS_CATEGORY: 'Functions' },
  },
};
