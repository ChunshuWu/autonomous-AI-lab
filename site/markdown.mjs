const mdEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeMarkdownURL=u=>/^(https?:\/\/|\/(?!\/)|#)/i.test(u)&&!/[\s<>"\\]/.test(u);
function markdownMath(text,display){
 if(globalThis.katex)return globalThis.katex.renderToString(text,{displayMode:display,throwOnError:false,trust:false,strict:'ignore',maxExpand:1000,maxSize:20});
 return '<span class="math-source" data-display="'+display+'">'+mdEscape(text)+'</span>';
}
export function renderMarkdownInline(text){
 const tokens=[];const token=html=>{tokens.push(html);return '\u0000'+(tokens.length-1)+'\u0000';};
 let s=String(text).replace(/\u0000/g,'');
 s=s.replace(/`([^`\n]+)`/g,(_,x)=>token('<code>'+mdEscape(x)+'</code>'));
 s=s.replace(/\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$/g,(_,a,b)=>token(markdownMath(a??b,false)));
 s=s.replace(/!?\[([^\]\n]+)\]\(([^\s)]+)\)/g,(_,label,url)=>token(safeMarkdownURL(url)?`<a href="${mdEscape(url)}" target="_blank" rel="noopener noreferrer">${mdEscape(label)}</a>`:mdEscape(label+' ('+url+')')));
 s=mdEscape(s).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
 return s.replace(/\u0000(\d+)\u0000/g,(_,n)=>tokens[Number(n)]);
}
// A small, escaped Markdown subset: text, headings, lists, tables, code and links.
// Raw HTML and executable URLs are never interpreted.
export function renderMarkdown(value){
 const lines=String(value||'').replace(/\r\n/g,'\n').split('\n'),out=[];let para=[],listType=null;
 const flush=()=>{if(para.length){out.push('<p>'+renderMarkdownInline(para.join(' '))+'</p>');para=[];}if(listType){out.push('</'+listType+'>');listType=null;}};
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(/^\s*```/.test(line)){flush();const code=[];while(++i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i]);out.push('<pre><code>'+mdEscape(code.join('\n'))+'</code></pre>');continue;}
  if(!line.trim()){flush();continue;}
  const mathStart=line.trim().match(/^(\$\$|\\\[)(.*)$/);
  if(mathStart){flush();const close=mathStart[1]==='$$'?'$$':'\\]',parts=[mathStart[2]];while(!parts.at(-1).trimEnd().endsWith(close)&&i+1<lines.length)parts.push(lines[++i]);let formula=parts.join('\n').trim();if(formula.endsWith(close)){formula=formula.slice(0,-close.length).trim();out.push(markdownMath(formula,true));}else out.push('<p>'+mdEscape(line+'\n'+parts.slice(1).join('\n'))+'</p>');continue;}
  if(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)){flush();out.push('<hr>');continue;}
  if(/^\s*>/.test(line)){flush();const quote=[line.replace(/^\s*>\s?/,'')];while(i+1<lines.length&&/^\s*>/.test(lines[i+1]))quote.push(lines[++i].replace(/^\s*>\s?/,''));out.push('<blockquote>'+renderMarkdown(quote.join('\n'))+'</blockquote>');continue;}
  const heading=line.match(/^(#{1,6})\s+(.+)$/);if(heading){flush();const level=heading[1].length;out.push('<h'+level+'>'+renderMarkdownInline(heading[2])+'</h'+level+'>');continue;}
  if(line.includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1]||'')){
   flush();const cells=s=>s.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
   const head=cells(line),rows=[];i++;
   while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim())rows.push(cells(lines[++i]));
   out.push('<div class="table-scroll"><table><thead><tr>'+head.map(x=>'<th>'+renderMarkdownInline(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+head.map((_,i)=>'<td>'+renderMarkdownInline(row[i]||'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>');continue;
  }
  const item=line.match(/^\s*(?:([-*])|\d+\.)\s+(.+)$/);if(item){const type=item[1]?'ul':'ol';if(para.length||listType!==type)flush();if(!listType){out.push('<'+type+'>');listType=type;}out.push('<li>'+renderMarkdownInline(item[2])+'</li>');continue;}
  if(listType)flush();para.push(line.trim());
 }
 flush();return out.join('\n');
}
