export const summarizeJsonShape = (value, depth = 0, maxDepth = 4) => {
  if (depth >= maxDepth) {
    if (Array.isArray(value)) {
      return `Array(${value.length})`;
    }

    if (value && typeof value === 'object') {
      return `Object(${Object.keys(value).length})`;
    }

    return value === null ? 'null' : typeof value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 'Array(0)';
    }

    return {
      type: 'Array',
      length: value.length,
      samples: value.slice(0, 3).map((item) => summarizeJsonShape(item, depth + 1, maxDepth)),
    };
  }

  if (value && typeof value === 'object') {
    const shape = {};
    Object.keys(value).forEach((key) => {
      shape[key] = summarizeJsonShape(value[key], depth + 1, maxDepth);
    });
    return shape;
  }

  return value === null ? 'null' : typeof value;
};
