import{A as e,B as t,D as n,E as r,F as i,G as a,I as o,J as s,L as c,M as l,N as u,O as d,Q as ee,R as f,S as te,U as ne,W as p,X as m,Y as h,Z as g,a as _,b as v,ct as re,d as y,et as b,i as x,it as S,j as C,k as w,mt as T,nt as E,p as D,pt as O,q as k,rt as A,s as j,st as ie,u as M,x as N,y as P}from"../chunks/bEiydLKe.js";import{l as ae}from"../chunks/B4g3Gbp2.js";import"../chunks/xihTtKlq.js";import{I as F,L as I,N as L,P as R,T as z}from"../chunks/DDFU1V5F.js";import{_ as oe,a as se,c as ce,g as B,h as V,i as le,l as ue,m as H,n as de,r as fe,t as pe,u as me}from"../chunks/CFIsWG6C.js";import{n as he,t as ge}from"../chunks/CnWIoYWZ.js";import{t as _e}from"../chunks/Mg7VeWVv.js";var U=`\x1B`,W=`${U}]8;;`,G=`${U}\\`,K={border:`2`,edge:`36`,edgeLabel:`2;36`,title:`1`},q=(e,t)=>`${t};2;${[1,3,5].map(t=>Number.parseInt(e.slice(t,t+2),16)).join(`;`)}`;function J(e,t,n){let r=[],i=(t===`border`?e.stroke??e.color:t===`edge`?void 0:e.color)??(e.fill===void 0?void 0:V(e.fill));return i!==void 0&&r.push(q(i,38)),e.fill!==void 0&&r.push(q(e.fill,48)),r.length===0&&n!==void 0&&r.push(n),e.bold===!0&&r.unshift(`1`),r.length>0?r.join(`;`):void 0}function ve(e,t=K){return e.styled.map(n=>n.map(n=>{let r=B(n.classes,e.classDefs),i=r===null?t[n.role]:J(r,n.role,t[n.role]),a=i===void 0?n.text:`${U}[${i}m${n.text}${U}[0m`;return n.href===void 0?a:`${W}${n.href}${G}${a}${W}${G}`}).join(``))}function ye(e,t){e=R(e);let n=` mermaid: ${e.split(/\s+/).filter(e=>e!==``)[0]??`diagram`} `,r=t===void 0?void 0:Math.max(8,z(t,4)),i=L(e).map(e=>be(e).replace(/\s+$/,``)).reduce((e,t)=>!e.started&&t===``?e:(e.started=!0,e.lines.push(...Y(t,r)),e),{started:!1,lines:[]}).lines,a=i.reduce((e,t)=>Math.max(e,I(t)),I(n)),o=a+2,s=[],c=[],l=`─`.repeat(z(o,I(n)));s.push(`╭${n}${l}╮`),c.push([{text:`╭`,role:`border`},{text:n,role:`title`},{text:`${l}╮`,role:`border`}]);for(let e of i){let t=` `.repeat(z(a,I(e)));s.push(`│ ${e}${t} │`),c.push([{text:`│ `,role:`border`},{text:e,role:`text`},{text:`${t} │`,role:`border`}])}let u=`╰${`─`.repeat(o)}╯`;return s.push(u),c.push([{text:u,role:`border`}]),{plain:s,styled:c,width:o+2,classDefs:{},warnings:[]}}function be(e){if(!e.includes(`	`))return e;let t=``,n=0;for(let[r,i]of F(e))if(r===`	`){let e=4-n%4;t+=` `.repeat(e),n+=e}else t+=r,n+=i;return t}function Y(e,t){if(t===void 0||I(e)<=t)return[e];let n=[],r=``,i=0;for(let[a,o]of F(e))i+o>t&&r!==``&&(n.push(r),r=``,i=0),r+=a,i+=o;return r!==``&&n.push(r),n}function xe(e){let t=document.createElement(`canvas`).getContext(`2d`);if(!t)return null;let n=t.font;if(t.font=`100px ${e}`,t.font===n)return null;let r=t.measureText(`M`);if(!(r.width>0))return null;let i=r.fontBoundingBoxAscent,a=r.fontBoundingBoxDescent;return{cellAspect:r.width/100,baseline:i+a>0?Math.min(1,Math.max(.5,i/(i+a))):.8}}var Se=new Set([`$$slots`,`$$events`,`$$legacy`,`text`,`rows`,`cols`,`margin`,`grid`,`frame`,`cellAspect`,`glyphScale`,`cellSize`,`theme`,`customGlyphs`]),Ce=u(`<text visibility="hidden" font-size="100" aria-hidden="true">M</text>`),we=u(`<rect></rect>`),Te=u(`<path fill="none"></path>`),X=u(`<rect fill="none"></rect>`),Z=u(`<path></path>`),Ee=u(`<a><tspan> </tspan></a>`),De=u(`<tspan> </tspan>`),Q=u(`<text fill="currentColor" xml:space="preserve"></text>`),Oe=u(`<svg><!><!><!><!><!><!></svg>`);function ke(t,i){re(i,!0);let o=x(i,`text`,3,``),s=x(i,`margin`,3,0),c=x(i,`grid`,3,!1),l=x(i,`frame`,3,!1),u=x(i,`cellAspect`,3,`auto`),ee=x(i,`glyphScale`,3,1),te=x(i,`cellSize`,3,50),ne=x(i,`customGlyphs`,3,!0),S=_(i,Se),O=E(void 0),k=E(void 0),M=E(null);a(()=>{if(u()!==`auto`||!f(O)||!f(k))return;let e=f(O),t=new ResizeObserver(()=>{let t=xe(getComputedStyle(e).fontFamily);t&&(t.cellAspect!==f(M)?.cellAspect||t.baseline!==f(M)?.baseline)&&b(M,t,!0)});return t.observe(f(k)),()=>t.disconnect()});let ae=A(()=>ue(me(o(),i.theme))),F=A(()=>ce(f(ae),{rows:i.rows,cols:i.cols,margin:s(),grid:c(),frame:l(),cellAspect:u()===`auto`?f(M)?.cellAspect:u(),baseline:u()===`auto`?f(M)?.baseline:void 0,glyphScale:ee(),cellSize:te(),customGlyphs:ne()})),I=A(()=>i.role??(S[`aria-label`]||S[`aria-labelledby`]?`img`:`presentation`));var L=Oe();y(L,()=>({viewBox:f(F).viewBox,width:f(F).width,height:f(F).height,overflow:`hidden`,preserveAspectRatio:`xMinYMin meet`,xmlns:`http://www.w3.org/2000/svg`,...S,role:f(I),style:`width: 100%; height: 100%; font-family: var(--ascii-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);${i.theme?.foreground?` color: ${i.theme.foreground};`:``}${i.style?` ${i.style}`:``}`}));var R=h(L),z=t=>{var n=Ce();j(n,e=>b(k,e),()=>f(k)),e(t,n)};d(R,e=>{u()===`auto`&&e(z)});var oe=g(R);r(oe,17,()=>f(F).rows,n,(t,i)=>{var a=C(),o=m(a);r(o,17,()=>f(i).bgs,n,(t,n)=>{var r=we();p(()=>{P(r,f(n).style),D(r,`x`,f(n).x),D(r,`y`,f(n).y),D(r,`width`,f(n).width),D(r,`height`,f(n).height)}),e(t,r)}),e(t,a)});var se=g(oe),B=t=>{var n=Te();p(()=>{v(n,0,N(f(F).grid.class)),D(n,`d`,f(F).grid.d),D(n,`stroke`,f(F).grid.stroke),D(n,`stroke-opacity`,f(F).grid.strokeOpacity),D(n,`stroke-width`,f(F).grid.strokeWidth)}),e(t,n)};d(se,e=>{f(F).grid&&e(B)});var V=g(se),le=t=>{var n=X();p(()=>{v(n,0,N(f(F).frame.class)),D(n,`x`,f(F).frame.x),D(n,`y`,f(F).frame.y),D(n,`width`,f(F).frame.width),D(n,`height`,f(F).frame.height),D(n,`stroke`,f(F).frame.stroke),D(n,`stroke-width`,f(F).frame.strokeWidth)}),e(t,n)};d(V,e=>{f(F).frame&&e(le)});var H=g(V);r(H,17,()=>f(F).rows,n,(t,i)=>{var a=C(),o=m(a);r(o,17,()=>f(i).shapes,n,(t,n)=>{var r=Z();p(()=>{P(r,f(n).style),D(r,`d`,f(n).d)}),e(t,r)}),e(t,a)});var de=g(H);r(de,17,()=>f(F).rows,n,(t,i)=>{var a=C(),o=m(a),s=t=>{var a=Q();r(a,21,()=>f(i).runs,n,(t,n)=>{var r=C(),i=m(r),a=t=>{var r=Ee(),i=h(r),a=h(i,!0);T(i),T(r),p(()=>{D(r,`href`,f(n).href),P(i,f(n).style),D(i,`x`,f(n).x),w(a,f(n).text)}),e(t,r)},o=t=>{var r=De(),i=h(r,!0);T(r),p(()=>{P(r,f(n).style),D(r,`x`,f(n).x),w(i,f(n).text)}),e(t,r)};d(i,e=>{f(n).href?e(a):e(o,-1)}),e(t,r)}),T(a),p(()=>{D(a,`y`,f(i).y),D(a,`font-size`,f(F).fontSize)}),e(t,a)};d(o,e=>{f(i).runs.length&&e(s)}),e(t,a)}),T(L),j(L,e=>b(O,e),()=>f(O)),e(t,L),ie()}var Ae='---\nname: lovely-mermaid\ndescription: Consult before emitting a ```mermaid block.\n---\n\n# Mermaid diagrams\n\n```mermaid fences render as Unicode box-drawing art. Supported types:\n\n- `flowchart` / `graph` — `TD`/`BT`/`LR`/`RL`, `subgraph` nesting, shapes\n  (`[rect]`, `(round)`, `{diamond}`, v2 `A@{shape: cyl, label: "…"}`),\n  `-->` / `-.->` / `==>` links, `o`/`x` end markers, `|edge labels|`.\n- `stateDiagram-v2` — transitions, `[*]`, `<<choice>>`, `id : description`,\n  composite `state X { … }` with `--` regions.\n- `classDiagram` — member compartments, `<<annotations>>`, `~generics~`,\n  all relation arrows, per-end `"cardinalities"`.\n- `erDiagram` — entities, attributes, crow\'s-foot cardinalities, quoted\n  aliases (`c["Credit Card"]`).\n- `sequenceDiagram` — messages, activations (`->>+` / `-->>-`), notes,\n  `loop`/`alt`/`opt`/`par` blocks, `autonumber`.\n- `pie` — drawn as a labelled bar list; `showData` appends raw values.\n- `mindmap` — the indentation tree, drawn with `├──` guides.\n- `timeline` — `period : event : event` rows, `section` headers.\n- `gitGraph` — `commit`/`branch`/`checkout`/`merge` with `id:`/`tag:`,\n  drawn like `git log --graph`, newest on top.\n\nWorks everywhere: YAML frontmatter `title:`, CJK and emoji in labels.\n\nFlowchart, state and class diagrams only: `:::class` tags +\n`classDef name fill:#f96,color:#000` node colors. Flowchart/class only:\n`click A "url"` / `link A "url"` become clickable OSC 8 hyperlinks.\n\nRules of thumb:\n\n- Quote label text containing `:`, `;`, `#` or brackets.\n- Other types (gantt, sankey, quadrant, …) fall back to displaying the block.\n- Terminals are narrow: prefer `TD` for long chains, keep labels short.\n',je=[{name:`flowchart`,desc:`nodes, branches, edge labels`,src:`flowchart TD
  A[Parse source] --> B{Supported?}
  B -->|yes| C[Lay out]
  B -->|no| D[Framed source]
  C --> E[Unicode art]
  D --> E`},{name:`title`,desc:`frontmatter title over the art`,src:`---
title: Deploy pipeline
---
flowchart LR
  Build --> Test
  Test --> Ship
  Ship --> Done`},{name:`shapes`,desc:`v2 @{shape, label} node syntax`,src:`flowchart TD
  S@{shape: start, label: "Boot"} --> D@{shape: cyl, label: "Config DB"}
  D --> Q@{shape: diamond, label: "Valid?"}
  Q -->|yes| P@{shape: stadium, label: "Run app"}
  Q -->|no| E@{shape: dbl-circ, label: "Halt"}`},{name:`subgraph`,desc:`nested titled frames`,src:`flowchart TD
  In[Request] --> R
  subgraph svc [Service]
    R[Router] --> H1[Handler A]
    R --> H2[Handler B]
  end
  H1 --> Out[(Store)]
  H2 --> Out`},{name:`cycles`,desc:`back and skip edges route around`,src:`flowchart TD
  A[Fetch] --> B{OK?}
  B -->|yes| C[Parse]
  B -->|no| R[Backoff]
  R --> A
  C --> D[Render]
  A -.->|cache hit| D`},{name:`pipeline`,desc:`retry loops at several depths`,src:`flowchart TD
  push[Git push] --> ci{CI green?}
  ci -->|yes| build[Build image]
  ci -->|no| notify[Notify author]
  build --> stage[Deploy staging]
  stage --> smoke{Smoke tests}
  smoke -->|flaky| stage
  smoke -->|pass| prod[Deploy prod]
  smoke -->|fail| notify
  prod --> monitor[Monitor SLOs]
  monitor -->|regression| roll[Rollback]
  roll --> stage
  notify --> push`},{name:`pipeline-lr`,desc:`the full pipeline sideways: lanes, labels on their lines`,src:`flowchart LR
  push[Git push] --> ci{CI green?}
  ci -->|yes| build[Build image]
  ci -->|no| notify[Notify author]
  build --> stage[Deploy staging]
  stage --> smoke{Smoke tests}
  smoke -->|flaky| stage
  smoke -->|pass| prod[Deploy prod]
  smoke -->|fail| notify
  prod --> monitor[Monitor SLOs]
  monitor -->|regression| roll[Rollback]
  roll --> stage
  notify --> push`},{name:`sequence`,desc:`participants, messages, notes`,src:`sequenceDiagram
  participant U as User
  participant T as Terminal
  participant R as Renderer
  U->>T: mermaid source
  T->>R: render()
  R-->>T: unicode art
  T-->>U: pretty boxes`},{name:`activations`,desc:`hot lifelines between +/- marks`,src:`sequenceDiagram
  Client->>+Server: request
  Server->>+DB: query
  DB-->>-Server: rows
  Server-->>-Client: response`},{name:`state`,desc:`transitions, start/end markers`,src:`stateDiagram-v2
  [*] --> Idle
  Idle --> Parsing: source arrives
  Parsing --> Drawing: parse ok
  Parsing --> Framed: parse fails
  Drawing --> [*]
  Framed --> [*]`},{name:`composite`,desc:`nested states and -- regions`,src:`stateDiagram-v2
  [*] --> Idle
  Idle --> Active
  state Active {
    [*] --> Fetching
    Fetching --> Rendering
    Rendering --> Fetching : retry
    --
    Log --> Flush
  }
  Active --> [*]`},{name:`class`,desc:`compartments, members, relations`,src:`classDiagram
  class MermaidArt {
    +plain: string[]
    +styled: Span[][]
    +width: number
    +warnings: string[]
  }
  class Span {
    +text: string
    +role: Role
  }
  MermaidArt "1" --> "*" Span : rows of`},{name:`styles`,desc:`classDef colors, best-effort applied`,src:`flowchart TD
  A[Request]:::hot --> B{Authorized?}
  B -->|yes| C[Serve]:::ok
  B -->|no| D[401 Denied]:::err
  C --> E[(Cache)]
  class E cold
  classDef hot fill:#ff9966,color:#000000
  classDef ok stroke:#22a06b,color:#22a06b
  classDef err fill:#8b0000,color:#ffdddd
  classDef cold fill:lightblue,color:#000000,font-weight:bold`},{name:`state-styles`,desc:`:::class + classDef in state diagrams`,src:`stateDiagram-v2
  [*] --> Healthy
  Healthy --> Degraded : probe fails
  Degraded --> Healthy : recovers
  Degraded --> Down:::alert : timeout
  Down --> [*]
  class Healthy ok
  classDef ok stroke:#22a06b,color:#22a06b
  classDef alert fill:#8b0000,color:#ffdddd,font-weight:bold`},{name:`links`,desc:`click/link → OSC 8 hyperlinks`,src:`flowchart TD
  A[README] --> B{Where?}
  B -->|terminal| C[npm]
  B -->|browser| D[GitHub]
  click C "https://www.npmjs.com/package/lovely-mermaid"
  click D "https://github.com/xl0/lovely-mermaid"`},{name:`er`,desc:`cardinalities at edge ends, aliases`,src:`erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  c["Credit Card"] |o--|| CUSTOMER : pays with`},{name:`mindmap`,desc:`indentation tree with TUI guides`,src:`mindmap
  root((lovely-mermaid))
    Parsing
      Lenient
      Streaming
    Layout
      Sugiyama
      Lanes
    Output
      Roles
      Classes`},{name:`timeline`,desc:`periods and events, sections`,src:`timeline
  title Project history
  section Port
  2026-07 : Byte-faithful port : Differential harness
  section Redesign
  2026-08 : Lenient parsing : Semantic spans
          : New diagram types`},{name:`pie`,desc:`proportions as a bar list`,src:`pie showData title Render targets
  "Terminals" : 62
  "TUIs" : 25
  "CI logs" : 13`},{name:`gitgraph`,desc:`commit lanes, git log --graph style`,src:`gitGraph
  commit id: "scaffold"
  branch feature
  commit id: "parse"
  checkout main
  commit id: "docs"
  merge feature tag: "v1.0"
  commit id: "polish"`},{name:`cjk`,desc:`wide glyphs measured correctly`,src:`flowchart LR
  A[你好世界] --> B[こんにちは]
  B --> C[🚀 Launch]
  C --> D[Done ✅]`},{name:`broken`,desc:`lenient parsing, advisory warnings`,src:`flowchart TD
  A[Start --> B
  C --> `}],Me=l(`<meta name="description" content="Render Mermaid diagrams as Unicode box-drawing art for terminals. No browser, no SVG — a self-contained layout engine that emits text." class="svelte-1uha8ag"/>`),Ne=l(`<span class="dim svelte-1uha8ag"> </span>`),Pe=l(`<span class="err svelte-1uha8ag">render(src) → null</span>`),Fe=l(`<a class="ghost svelte-1uha8ag" target="_blank" rel="noopener">[view]</a>`),Ie=l(`<span class="fit-arrow svelte-1uha8ag">▲ fits</span>`),Le=l(`<span class="vp svelte-1uha8ag"><button> </button><!></span>`),Re=l(`<div class="art svelte-1uha8ag"><!></div>`),ze=l(`<div class="art empty svelte-1uha8ag">⏳ waiting for a diagram…</div>`),Be=l(`<div class="svelte-1uha8ag"> </div>`),Ve=l(`<div class="tool-warnings svelte-1uha8ag"></div>`),He=l(`<button role="option"> </button>`),Ue=l(`<span class="svelte-1uha8ag"> </span>`),We=l(`<div class="overlay svelte-1uha8ag" role="presentation"><div class="skill-box svelte-1uha8ag" role="dialog" aria-modal="true" aria-label="The lovely-mermaid agent skill"><div class="skill-title svelte-1uha8ag"><a href="https://github.com/xl0/lovely-mermaid/blob/master/skills/lovely-mermaid/SKILL.md" class="svelte-1uha8ag">skills/lovely-mermaid/SKILL.md</a> <span class="spacer svelte-1uha8ag"></span> <button class="ghost svelte-1uha8ag"> </button> <button class="ghost svelte-1uha8ag">[esc]</button></div> <pre class="svelte-1uha8ag"> </pre></div></div>`),Ge=l(`<main class="svelte-1uha8ag"><div class="assistant svelte-1uha8ag"><div class="header-row svelte-1uha8ag"><span class="md-h svelte-1uha8ag"># lovely-mermaid</span> <span class="spacer svelte-1uha8ag"></span> <button class="ghost svelte-1uha8ag"> </button> <button class="ghost svelte-1uha8ag">skill</button> <a href="https://github.com/xl0/lovely-mermaid" class="svelte-1uha8ag">GitHub</a> <a href="https://www.npmjs.com/package/lovely-mermaid" class="svelte-1uha8ag">npm</a></div> <p class="svelte-1uha8ag">I render Mermaid diagrams as Unicode box-drawing art, for terminals.</p></div> <div class="custom-block svelte-1uha8ag"><div class="custom-label svelte-1uha8ag">theme</div> <p class="dim note svelte-1uha8ag">Spans carry roles, never colors — the consumer maps them to an <code class="svelte-1uha8ag">AnsiTheme</code>. Styling per role regenerates the SGR codes: the exact bytes a
			terminal would get. Defaults are the library's <code class="svelte-1uha8ag">DEFAULT_THEME</code>.</p> <!> <div class="themecode svelte-1uha8ag"><pre class="svelte-1uha8ag"> </pre> <button class="tb-copy svelte-1uha8ag" title="Copy the AnsiTheme literal"> </button></div></div> <div class="tool-block svelte-1uha8ag"><div class="tool-title svelte-1uha8ag"><span class="dot svelte-1uha8ag">⏺</span> <code class="svelte-1uha8ag"> </code> <!> <!> <!> <span class="spacer svelte-1uha8ag"></span> <!> <button class="ghost svelte-1uha8ag"> </button> <span class="cols svelte-1uha8ag"><span class="dim svelte-1uha8ag">viewport</span> <!></span> <button class="ghost svelte-1uha8ag"> </button></div> <!> <!></div> <div class="editor-box svelte-1uha8ag"><span class="editor-title svelte-1uha8ag">Edit me</span> <span class="accent svelte-1uha8ag">❯</span> <textarea wrap="off" spellcheck="false" aria-label="Mermaid source" class="svelte-1uha8ag"></textarea></div> <div class="examples svelte-1uha8ag" role="listbox" aria-label="Example diagrams"></div> <div class="statusline svelte-1uha8ag"><span class="accent svelte-1uha8ag">lovely-mermaid</span> <span class="svelte-1uha8ag"> </span> <!> <span> </span> <span class="spacer svelte-1uha8ag"></span> <span class="dim svelte-1uha8ag">100% text</span></div></main> <!>`,1);function Ke(i,l){re(l,!0);let u=E(ee(je[0].src)),_=E(60),y=E(!0);a(()=>{document.body.classList.toggle(`light`,!f(y))});let x=E(ee(structuredClone(le.dark)));function C(e){b(y,e,!0),b(x,structuredClone(le[e?`dark`:`light`]),!0)}let j=E(!1),N=E(!1),P=A(()=>de.map(e=>[e,se(f(x)[e])]).filter(([,e])=>e!==null)),F=A(()=>Object.fromEntries(f(P))),I=A(()=>({palette:pe,foreground:fe[f(y)?`dark`:`light`].fg,background:fe[f(y)?`dark`:`light`].bg})),L=A(()=>f(P).length===0?`const theme: AnsiTheme = {};`:`const theme: AnsiTheme = {\n${f(P).map(([e,t])=>`\t${e}: '${t}',`).join(`
`)}\n};`);async function R(){await navigator.clipboard.writeText(f(L)),b(N,!0),setTimeout(()=>b(N,!1),1200)}let z=E(null),ce=``;function B(e=!1){f(z)!==null&&(clearInterval(f(z)),b(z,null),e&&b(u,ce,!0))}function V(){if(f(z)!==null){B(!0);return}ce=f(u);let e=[...f(u)],t=0;b(u,``),b(z,setInterval(()=>{t=Math.min(t+2,e.length),b(u,e.slice(0,t).join(``),!0),t>=e.length&&B()},40),!0)}async function ue(e){B();let n=document.documentElement.scrollHeight-window.scrollY;b(u,e.src,!0);let r=H(e.src);r!==null&&r.width>f(_)&&b(_,[30,60,120].find(e=>r.width<=e)??1/0,!0),await t(),window.scrollTo({top:document.documentElement.scrollHeight-n})}let me=location.hash.length>1,U=E(!me);me&&he(location.hash.slice(1)).then(e=>b(u,e,!0)).catch(()=>{}).finally(()=>b(U,!0));let W=E(``),G=0;a(()=>{let e=f(u);if(!f(U))return;let t=++G;if(e===``){b(W,``),history.replaceState(null,``,location.pathname);return}ge(e).then(e=>{t===G&&(b(W,e,!0),history.replaceState(null,``,`#${e}`))})});let K=A(()=>{let e=performance.now();return{art:f(u).trim()===``?null:H(f(u)),ms:performance.now()-e}}),q=A(()=>f(K).art),J=A(()=>f(q)!==null&&f(q).width<=f(_)),be=A(()=>f(q)!==null&&!f(J)?[30,60,120,1/0].find(e=>e>f(_)&&f(q).width<=e)??null:null),Y=A(()=>f(u).trim()===``?null:f(J)?f(q):ye(f(u),f(_)===1/0?void 0:f(_))),xe=A(()=>f(Y)===null?`idle`:f(q)===null?`error`:f(J)?`ok`:`pending`),Se=A(()=>f(q)===null||!f(J)?f(_)===1/0?`sourceBox(src)`:`sourceBox(src, ${f(_)})`:`render(src)`),Ce=A(()=>je.find(e=>e.src===f(u))?.desc??null),we=A(()=>f(Y)===null?``:ve(f(Y),f(F)).join(`
`));async function Te(){f(Y)&&(await navigator.clipboard.writeText(f(Y).plain.join(`
`)),b(j,!0),setTimeout(()=>b(j,!1),1200))}let X=E(!1),Z=E(!1);a(()=>{document.documentElement.style.overflow=f(X)?`hidden`:``});async function Ee(){await navigator.clipboard.writeText(Ae),b(Z,!0),setTimeout(()=>b(Z,!1),1200)}var De=Ge();c(`keydown`,s,e=>{e.key===`Escape`&&b(X,!1)}),te(`1uha8ag`,t=>{var n=Me();ne(()=>{k.title=`lovely-mermaid — Mermaid diagrams as Unicode art`}),e(t,n)});var Q=m(De),Oe=h(Q),Ke=h(Oe),qe=g(h(Ke),4),Je=h(qe);T(qe);var Ye=g(qe,2);O(4),T(Ke),O(2),T(Oe);var Xe=g(Oe,2),Ze=g(h(Xe),4);_e(Ze,{onreset:()=>C(f(y)),get theme(){return f(x)},set theme(e){b(x,e,!0)}});var Qe=g(Ze,2),$e=h(Qe),et=h($e,!0);T($e);var tt=g($e,2),nt=h(tt,!0);T(tt),T(Qe),T(Xe);var rt=g(Xe,2),it=h(rt),at=g(h(it),2),ot=h(at,!0);T(at);var st=g(at,2),ct=t=>{var n=Ne(),r=h(n);T(n),p(()=>w(r,`· ${f(Ce)??``}`)),e(t,n)};d(st,e=>{f(Ce)&&e(ct)});var lt=g(st,2),ut=t=>{var n=Ne(),r=h(n);T(n),p(()=>w(r,`art is ${f(q).width??``} cols${f(J)?``:` > ${f(_)}`}`)),e(t,n)},dt=t=>{var n=Pe();e(t,n)};d(lt,e=>{f(q)?e(ut):f(Y)&&e(dt,1)});var ft=g(lt,2),pt=t=>{var n=Ne(),r=h(n);T(n),p(e=>w(r,`${e??``} ms`),[()=>f(K).ms<.05?`<0.1`:f(K).ms.toFixed(1)]),e(t,n)};d(ft,e=>{f(Y)&&e(pt)});var mt=g(ft,4),ht=t=>{var n=Fe();p(()=>D(n,`href`,`${ae??``}/render/${f(W)??``}`)),e(t,n)};d(mt,e=>{f(W)!==``&&e(ht)});var $=g(mt,2),gt=h($);T($);var _t=g($,2),vt=g(h(_t),2);r(vt,16,()=>[30,60,120,1/0],e=>e,(t,n)=>{var r=Le(),i=h(r);let a;var s=h(i);T(i);var c=g(i),l=t=>{var n=Ie();e(t,n)};d(c,e=>{f(be)===n&&e(l)}),T(r),p(()=>{a=v(i,1,`ghost svelte-1uha8ag`,null,a,{active:f(_)===n}),w(s,`[${(n===1/0?`∞`:n)??``}]`)}),o(`click`,i,()=>b(_,n,!0)),e(t,r)}),T(_t);var yt=g(_t,2),bt=h(yt,!0);T(yt),T(it);var xt=g(it,2),St=t=>{var n=Re(),r=h(n);{let e=A(()=>f(_)===1/0?f(Y).width:Math.max(f(_),f(Y).width));ke(r,{get text(){return f(we)},get theme(){return f(I)},get cols(){return f(e)},margin:1,cellSize:15,style:`width: auto; height: auto;`,"aria-label":`Rendered diagram`})}T(n),e(t,n)},Ct=t=>{var n=ze();e(t,n)};d(xt,e=>{f(Y)?e(St):e(Ct,-1)});var wt=g(xt,2),Tt=t=>{var i=Ve();r(i,21,()=>f(q).warnings,n,(t,n)=>{var r=Be(),i=h(r);T(r),p(()=>w(i,`⚠ ${f(n)??``}`)),e(t,r)}),T(i),e(t,i)};d(wt,e=>{f(q)&&f(q).warnings.length&&e(Tt)}),T(rt);var Et=g(rt,2),Dt=g(h(Et),4);S(Dt),T(Et);var Ot=g(Et,2);r(Ot,21,()=>je,e=>e.name,(t,n)=>{var r=He();let i;var a=h(r);T(r),p(()=>{i=v(r,1,`example svelte-1uha8ag`,null,i,{active:f(u)===f(n).src}),D(r,`aria-selected`,f(u)===f(n).src),w(a,`/${f(n).name??``}`)}),o(`click`,r,()=>ue(f(n))),e(t,r)}),T(Ot);var kt=g(Ot,2),At=g(h(kt),2),jt=h(At,!0);T(At);var Mt=g(At,2),Nt=t=>{var n=Ue(),r=h(n);T(n),p(()=>w(r,`${f(Y).width??``}×${f(Y).plain.length??``} cells`)),e(t,n)};d(Mt,e=>{f(Y)&&e(Nt)});var Pt=g(Mt,2);let Ft;var It=h(Pt);T(Pt),O(4),T(kt),T(Q);var Lt=g(Q,2),Rt=t=>{var n=We(),r=h(n),i=h(r),a=g(h(i),4),s=h(a,!0);T(a);var c=g(a,2);T(i);var l=g(i,2),u=h(l,!0);T(l),T(r),T(n),p(()=>{w(s,f(Z)?`copied`:`[copy]`),w(u,Ae)}),o(`click`,n,e=>{e.target===e.currentTarget&&b(X,!1)}),o(`click`,a,Ee),o(`click`,c,()=>b(X,!1)),e(t,n)};d(Lt,e=>{f(X)&&e(Rt)}),p((e,t,n)=>{w(Je,`[${f(y)?`light`:`dark`}]`),w(et,f(L)),w(nt,f(N)?`[copied]`:`[copy]`),D(rt,`data-state`,f(xe)),w(ot,f(Se)),$.disabled=e,w(gt,`[${f(z)===null?`stream`:`stop`}]`),yt.disabled=!f(Y),w(bt,f(j)?`copied`:`[copy]`),D(Dt,`rows`,t),w(jt,n),Ft=v(Pt,1,`svelte-1uha8ag`,null,Ft,{warn:f(q)!==null&&f(q).warnings.length>0}),w(It,`⚠ ${f(q)?.warnings.length??0??``}`)},[()=>f(u).trim()===``&&f(z)===null,()=>Math.max(2,f(u).split(`
`).length),()=>oe(f(u))??`unknown`]),o(`click`,qe,()=>C(!f(y))),o(`click`,Ye,e=>{e.stopPropagation(),b(X,!0)}),o(`click`,tt,R),o(`click`,$,V),o(`click`,yt,Te),o(`input`,Dt,()=>B()),M(Dt,()=>f(u),e=>b(u,e)),e(i,De),ie()}i([`click`,`input`]);export{Ke as component};