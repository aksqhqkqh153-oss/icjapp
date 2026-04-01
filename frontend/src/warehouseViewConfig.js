export const WAREHOUSE_VIEW_CONFIG = {
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
  ],
}
