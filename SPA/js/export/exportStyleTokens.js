const EXPORT_BRAND_PINK_ARGB = 'FFE83E8C';
const EXPORT_WHITE_ARGB = 'FFFFFFFF';

export const OVERVIEW_TITLE_COLUMN_SPAN = 8;
export const EXCEL_COLUMN_WIDTH_TO_PREVIEW_PX = 7;

export const EXPORT_HEADER_STYLE = {
  font: {
    bold: true,
    size: 16,
    color: { argb: EXPORT_WHITE_ARGB },
  },
  fill: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: EXPORT_BRAND_PINK_ARGB },
  },
};

export const EXPORT_TITLE_STYLE = {
  font: {
    bold: true,
    size: 18,
    color: { argb: EXPORT_WHITE_ARGB },
  },
  fill: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: EXPORT_BRAND_PINK_ARGB },
  },
  alignment: { horizontal: 'center', vertical: 'middle' },
};

export const PREVIEW_THEME_TOKENS = {
  bodyFontFamily: 'Arial, sans-serif',
  bodyPaddingPx: 12,
  titleFontSizePx: 18,
  titleMargin: '0 0 12px',
  tableBorderColor: '#ccc',
  tableCellPadding: '6px 8px',
  tableFontSizePx: 12,
  previewRowTitleFontSizePx: 14,
  previewCellDefaultBackground: '#fff',
};
