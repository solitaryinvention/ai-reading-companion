export const chatFonts = [
  { id: 'system', name: '现代无衬线（推荐）', family: 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif' },
  { id: 'yahei', name: '微软雅黑', family: '"Microsoft YaHei", sans-serif' },
  { id: 'deng', name: '等线', family: 'DengXian, "Microsoft YaHei", sans-serif' },
  { id: 'song', name: '宋体', family: 'SimSun, "Songti SC", serif' },
  { id: 'kai', name: '楷体', family: 'KaiTi, STKaiti, serif' },
  { id: 'fangsong', name: '仿宋', family: 'FangSong, STFangsong, serif' },
] as const;
export const chatFontFamily = (id?: string) => (chatFonts.find(font => font.id === id) || chatFonts[0]).family;
