const disallowedValues = [
  '[not provided]',
  'placeholder',
  '[[unknown]]',
  'not set',
  'not provided',
  'unknown',
  'undefined',
  'n/a',
];

const filterNullValuesFromObject = (object) =>
  Object.fromEntries(
    Object.entries(object).filter(
      ([_, v]) =>
        v !== null &&
        v !== '' &&
        typeof v !== 'undefined' &&
        (typeof v !== 'string' ||
          !disallowedValues.includes(v.toLowerCase()) ||
          !v.toLowerCase().includes('!$record'))
    )
  );

const normalizePropertyName = (key) =>
  key
    .toLowerCase()
    .replace(/__c$/, '')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

const goal = (actions) => {
  // this is where the data will be written to the database

  // switched to foreach for better readability,
  // because console.log(actions) will not print every action
  actions.forEach((action) => {
    console.log(action);
  });
};

module.exports = {
  filterNullValuesFromObject,
  normalizePropertyName,
  goal,
};
