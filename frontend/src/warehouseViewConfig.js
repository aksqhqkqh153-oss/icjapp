export const WAREHOUSE_VIEW_CONFIG = {
  inputTabs: [
    { key: 'galmae', title: '갈매', sheetName: '갈매창고입력시트', type: 'full' },
    { key: 'gimpo', title: '김포', sheetName: '김포창고입력시트', type: 'full' },
    {
      key: 'galmae-edit',
      title: '갈매(편집)',
      sheetName: '갈매창고입력시트',
      type: 'range',
      range: {
        startRow: 1,
        endRow: 19,
        startCol: 4,
        endCol: 8,
      },
    },
    {
      key: 'gimpo-edit',
      title: '김포(편집)',
      sheetName: '김포창고입력시트',
      type: 'range',
      range: {
        startRow: 1,
        endRow: 19,
        startCol: 4,
        endCol: 8,
      },
    },
  ],
  warehouseTabs: [
    { key: 'galmae', title: '갈매창고', sheetName: '갈매창고', type: 'full' },
    { key: 'gimpo', title: '김포창고', sheetName: '김포창고', type: 'full' },
    {
      key: 'galmae-view',
      title: '갈매창고(뷰)',
      sheetName: '갈매창고',
      type: 'range',
      range: {
        startRow: 18,
        endRow: 33,
        startCol: 1,
        endCol: 10,
      },
    },
    {
      key: 'gimpo-view',
      title: '김포창고(뷰)',
      sheetName: '김포창고',
      type: 'range',
      range: {
        startRow: 14,
        endRow: 25,
        startCol: 1,
        endCol: 8,
      },
    },
  ],
}
