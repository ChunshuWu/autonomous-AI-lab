// Dashboard presentation only. Never write these aliases into research records.
// Agent records remain permanent; only explicit dismissal releases a display identity.
export const cats = [
  {"id":"alugalug","name":"Alugalug","image":"/cats/alugalug.png","byline":"Researcher · WuLab","bio":"Away from the lab, Alugalug is known for the rolling vocals in The Kiffness’s Alugalug Cat songs. Those calls brought musicians from around the world together in a shared song.","source":{"label":"The story · The Kiffness","url":"https://www.thekiffness.com/2021/alugalug-cat-becomes-international-collaborative-song"}},
  {"id":"lonely","name":"George Rufus","image":"/cats/lonely.png","byline":"Researcher · WuLab","bio":"Outside research, George Rufus is known for Sometimes I’m Alone, a song made with The Kiffness. You may also know this member of the team as Lonely Cat.","source":{"label":"Watch · The Kiffness","url":"https://www.youtube.com/watch?v=lwLLFbC1H0c"},"extraSource":{"label":"George Rufus · Official profile","url":"https://linktr.ee/georgerufus"}},
  {"id":"hahee","name":"Chai Kichi","image":"/cats/hahee.png","byline":"Researcher · WuLab","bio":"Outside research, Chai Kichi has a musical collaboration with The Kiffness: Ha Hee. A distinctive two-part call is the heart of the song.","source":{"label":"Watch · The Kiffness","url":"https://www.youtube.com/watch?v=SZuN2QzKUtA"}},
  {"id":"johnson","name":"Johnson","image":"/cats/johnson.png","byline":"Researcher · WuLab","bio":"Outside the lab, Johnson appears in The Kiffness’s Hold Onto My Fur, credited as Oh Long Johnson 2.0. The original performance came from a video shared on Douyin in China.","source":{"label":"Watch · The Kiffness","url":"https://www.youtube.com/watch?v=Fy29jBqckCo"}},
  {"id":"billy","name":"Billy","image":"/cats/billy.png","byline":"Researcher · WuLab","bio":"Beyond research, Billy is known for the song Big Billy with The Kiffness. A short vocal performance grew into a full song on the Cat Jams collection.","source":{"label":"Watch · The Kiffness","url":"https://www.youtube.com/watch?v=T0P6MC8Ris8"}},
  {"id":"numnum","name":"Leo","image":"/cats/numnum.png","position":"50% 42%","byline":"Researcher · WuLab","bio":"Outside research, Leo is known as Numnum Cat. A musical snack break became a collaboration with The Kiffness, joined by violin, accordion, and trumpet.","source":{"label":"Listen · The Kiffness","url":"https://thekiffness.bandcamp.com/track/the-kiffness-numnum-cat"},"video":"https://www.youtube.com/watch?v=GArzu9ttQ0M","extraSource":{"label":"About Leo","url":"https://knowyourmeme.com/memes/numnum-cat"}},
  {"id":"serafino","name":"Serafino","image":"/cats/serafino.png","byline":"Researcher · WuLab","bio":"Beyond the lab, Serafino has a song of the same name with The Kiffness. The single was released in May 2026.","source":{"label":"Watch · The Kiffness","url":"https://www.youtube.com/watch?v=YYA1zwRP9z8"},"extraSource":{"label":"Single credits","url":"https://music.apple.com/us/album/serafino-single/1895865386"}},
  {"id":"gomeow","name":"Cala","image":"/cats/gomeow.png","byline":"Researcher · WuLab","bio":"Outside research, Cala is known for I Go Meow, a collaboration with The Kiffness. Her unmistakable voice is at the heart of the song.","source":{"label":"Watch · The Kiffness","url":"https://www.youtube.com/watch?v=r7WI4A8N8dA"}},
  {"id":"maodie","name":"Maodie","image":"/cats/maodie.png","byline":"Researcher · 耄耋","bio":"Away from the lab, Maodie is known on the Chinese internet as 圆头耄耋, or round-headed Maodie. Wide eyes and expressive reactions have made this team member easy to recognize.","source":{"label":"About Maodie","url":"https://zh.wikipedia.org/wiki/圆头猫爹"}},
  {"id":"comet","name":"Comet","image":"/cats/comet.jpeg","position":"50% 48%","byline":"Resident researcher · Male","resident":true,"bio":"Comet is a homegrown member of WuLab’s research team. He shares his home lab with Norma."},
  {"id":"norma","name":"Norma","image":"/cats/norma.jpeg","position":"50% 42%","byline":"Resident researcher · Female","resident":true,"bio":"Norma is a homegrown member of WuLab’s research team. She shares her home lab with Comet."},
  {"id":"potato","name":"Potato","image":"/cats/potato.png","position":"50% 42%","byline":"Researcher · Away from the lab","bio":"Potato is WuLab’s twelfth researcher and works away from the lab. Potato may look different from the rest of the team, but is every bit a qualified researcher."}
];

export function catFor(agent,agents=[]){
  if(agent&&Object.hasOwn(agent,'dashboard_cat_id'))return cats.find(c=>c.id===agent.dashboard_cat_id)||null;
  const slot=agents.findIndex(a=>a.id===agent?.id);
  return slot>=0&&slot<cats.length?cats[slot]:null;
}
export function pinDashboardIdentities(agents){
  // Freeze legacy assignments before allocating a replacement. Never shift old authors.
  for(const agent of agents)if(!Object.hasOwn(agent,'dashboard_cat_id'))agent.dashboard_cat_id=catFor(agent,agents)?.id||null;
}
export function assignDashboardIdentity(agent,agents){
  pinDashboardIdentities(agents);
  const used=new Set(agents.filter(a=>!a.dismissal).map(a=>a.dashboard_cat_id));
  agent.dashboard_cat_id=cats.find(c=>!used.has(c.id))?.id||null;
}
export function agentName(agent,agents=[]){
  return catFor(agent,agents)?.name||String(agent?.name??'').replace(/^Test\s*[·:-]\s*/i,'');
}
