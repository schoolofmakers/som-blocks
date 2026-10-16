import type { BlockFamily } from '../types';

// `raw` family: type C++ directly. The smallest family that exercises the generator
// sections: `som_raw_include` feeds the includes section, `som_raw_statement` the loop body.
// Meant for the full toolbox / teachers, not the starter toolbox.

const COLOUR = '#5b6770';

export const rawFamily: BlockFamily = {
  id: 'raw',
  blocks: [
    {
      type: 'som_raw_statement',
      message0: '%{BKY_SOM_RAW_STATEMENT}',
      args0: [{ type: 'field_input', name: 'CODE', text: '' }],
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_RAW_STATEMENT_TOOLTIP}',
    },
    {
      type: 'som_raw_include',
      message0: '%{BKY_SOM_RAW_INCLUDE}',
      args0: [{ type: 'field_input', name: 'HEADER', text: 'Wire.h' }],
      previousStatement: null,
      nextStatement: null,
      colour: COLOUR,
      tooltip: '%{BKY_SOM_RAW_INCLUDE_TOOLTIP}',
    },
  ],
  generators: {
    som_raw_statement: (block) => {
      const code = String(block.getFieldValue('CODE') ?? '').trim();
      return code ? `${code}\n` : '';
    },
    som_raw_include: (block, generator) => {
      generator.addInclude(String(block.getFieldValue('HEADER') ?? ''));
      return '';
    },
  },
  toolbox: {
    kind: 'category',
    name: '%{BKY_SOM_RAW_CATEGORY}',
    colour: COLOUR,
    contents: [
      { kind: 'block', type: 'som_raw_include' },
      { kind: 'block', type: 'som_raw_statement' },
    ],
  },
  messages: {
    es: {
      SOM_RAW_CATEGORY: 'Código',
      SOM_RAW_STATEMENT: 'código C++ %1',
      SOM_RAW_STATEMENT_TOOLTIP: 'Escribe una línea de C++ tal cual. Se copia sin cambios.',
      SOM_RAW_INCLUDE: 'incluir librería %1',
      SOM_RAW_INCLUDE_TOOLTIP: 'Agrega un #include al inicio del programa.',
    },
    en: {
      SOM_RAW_CATEGORY: 'Code',
      SOM_RAW_STATEMENT: 'C++ code %1',
      SOM_RAW_STATEMENT_TOOLTIP: 'Write one line of C++. It is copied exactly as typed.',
      SOM_RAW_INCLUDE: 'include library %1',
      SOM_RAW_INCLUDE_TOOLTIP: 'Adds an #include at the top of the program.',
    },
  },
};
