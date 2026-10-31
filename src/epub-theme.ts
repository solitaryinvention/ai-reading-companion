import type { Settings } from './types';

/** Reader typography takes precedence over publisher sizes without changing book text or CFIs. */
export function epubTheme(s: Settings) {
  const night = s.theme === 'night';
  const bg = night ? '#202623' : s.theme === 'white' ? '#ffffff' : '#f8f5ed';
  const ink = night ? '#dbe1da' : '#323630';
  const muted = night ? '#96a292' : '#737d6f';
  const font =
    s.readingFont === 'sans'
      ? '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
      : '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, Georgia, serif';
  return `
:root { --reader-segment-bg:${night ? '#303c31' : '#eef2e8'}; --reader-segment-ink:${night ? '#dbe1da' : '#304332'}; }
html { background:${bg}!important; color:${ink}!important; scroll-behavior:auto; scrollbar-width:auto; scrollbar-color:${night ? '#535b54' : '#d7d8cf'} transparent; color-scheme:${night ? 'dark' : 'light'}; }
[data-reader-note] { display:none!important; }
::-webkit-scrollbar { width:12px; height:12px; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:${night ? '#535b54' : '#c1c7b9'}; border:2px solid ${bg}; border-radius:8px; }
body { box-sizing:border-box!important; width:100%!important; max-width:760px!important; min-height:100vh; margin:0 auto!important; padding:48px clamp(28px,6vw,64px) 96px!important; background:${bg}!important; color:${ink}!important; font-family:${font}!important; font-size:${s.fontSize}px!important; font-weight:400!important; line-height:${s.lineHeight}!important; letter-spacing:.025em; overflow-wrap:break-word; -webkit-font-smoothing:antialiased; }
body :is(div,section,article,p,li,span) { font-family:inherit!important; font-size:inherit!important; line-height:inherit!important; color:inherit!important; background-color:transparent!important; }
body :is(p,div,section,article) { max-width:100%!important; }
p { margin:0 0 1.05em!important; padding:0!important; text-align:justify!important; text-align-last:auto!important; text-justify:inter-ideograph; word-spacing:normal!important; letter-spacing:.01em!important; text-indent:2em!important; orphans:2; widows:2; }
h1,h2,h3,h4,h5,h6 { font-family:"Microsoft YaHei","PingFang SC",sans-serif!important; color:${ink}!important; line-height:1.6!important; letter-spacing:.035em; text-align:left!important; text-indent:0!important; padding:0!important; font-weight:600!important; overflow-wrap:anywhere; }
h1 { font-size:1.38em!important; margin:1.2em 0 1.8em!important; }
h2 { font-size:1.18em!important; margin:2em 0 1.1em!important; }
h3,h4,h5,h6 { font-size:1.05em!important; margin:1.8em 0 .8em!important; }
h1+h2 { margin-top:0!important; }
h1 span,h2 span,h3 span,h4 span { font-size:inherit!important; font-weight:inherit!important; }
blockquote { margin:1.4em 0!important; padding:.3em 0 .3em 1.1em!important; border-left:2px solid ${night ? '#535d52' : '#d8ddcf'}; color:${muted}!important; }
blockquote p,li p,figcaption p { text-indent:0!important; }
ol,ul { padding-left:1.6em!important; margin:1em 0 1.4em!important; } li { padding-left:.3em; margin:.45em 0; text-align:justify; }
p.reader-media { text-indent:0!important; text-align:center!important; clear:both; }
img { display:inline-block; vertical-align:middle; }
img,svg,video { max-width:100%!important; height:auto!important; object-fit:contain; } figure { margin:1.8em 0!important; text-align:center; } figcaption { font-size:.82em!important; color:${muted}!important; line-height:1.7; }
table { max-width:100%; border-collapse:collapse; font-size:.88em; } td,th { padding:.5em; border:1px solid ${night ? '#444c44' : '#dce0d6'}; } pre { overflow-x:auto; white-space:pre-wrap; } code { font-size:.9em; }
a { color:${night ? '#9eb69a' : '#527b58'}!important; text-decoration:none; border-bottom:1px solid #8eab853d; } hr { border:0; border-top:1px solid ${night ? '#444c44' : '#e1e3d9'}; margin:2em 0; }
.source { font-family:"Microsoft YaHei",sans-serif!important; font-size:.72em!important; color:${muted}!important; text-indent:0!important; margin:-1em 0 2em!important; letter-spacing:.02em; }
::selection { background:${night ? '#63775c' : '#dbe8d0'}; color:${ink}; }
@media(max-width:420px) { body { padding:30px 24px 72px!important; } h1 { font-size:1.25em!important; } }
`;
}
