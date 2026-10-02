// 100-point post rating. The same function lives in public/admin.html (the test
// checks both give identical results). Parts: importance 40, fact check 25,
// freshness 15, media 10, source 10.
export function postRating(x){
  x=x||{};
  var v2=x.editorialV2||{},parts=[];
  var imp=Number(v2.importance);
  var impPts,impNote;
  if(v2.importance!=null&&Number.isFinite(imp)){impPts=Math.round(Math.max(0,Math.min(10,imp))*4);impNote='Редакция оценила важность на '+imp+' из 10';}
  else if(Number.isFinite(Number(x.aiScore))&&x.aiScore!==''&&x.aiScore!=null){impPts=Math.round(Math.max(0,Math.min(100,Number(x.aiScore)))*0.4);impNote='Оценка AI '+Math.round(Number(x.aiScore))+' из 100';}
  else{impPts=0;impNote='Важность не оценена';}
  parts.push({label:'Важность для читателя',short:'Важность',got:impPts,max:40,note:impNote});

  var rounds=Number(v2.rounds)||0,verdict=String(v2.verdict||''),st=String(v2.status||'');
  var chk,chkNote;
  if(st==='skip'||x.status==='editorial_skip'){chk=0;chkNote='Редакция пропустила'+(v2.skipReason||x.skipReason?': '+(v2.skipReason||x.skipReason):'');}
  else if(st==='approved'||verdict==='pass'){chk=Math.max(17,25-rounds*4);chkNote=rounds?('GPT и Claude приняли после исправлений ('+rounds+')'):'GPT и Claude: без замечаний';}
  else if(verdict==='unavailable'){chk=8;chkNote='Одна из нейросетей не ответила';}
  else if(verdict==='reject'){chk=0;chkNote='Проверка нашла ошибки и отклонила';}
  else if(verdict==='fix_exhausted'){chk=3;chkNote='Ошибки не исправлены за отведённые раунды';}
  else if(verdict==='copyright_overlap'){chk=3;chkNote='Текст слишком близок к источнику';}
  else if(x.qcStatus==='pass'){chk=18;chkNote='Пройдена старая проверка качества';}
  else if(x.qcStatus==='hold'){chk=8;chkNote='Ждёт ручной проверки';}
  else{chk=10;chkNote='Двойная проверка не проводилась';}
  parts.push({label:'Проверка фактов',short:'Факты',got:chk,max:25,note:chkNote});

  var pub=new Date(x.articlePublishedAt||0).getTime(),found=new Date(x.foundAt||0).getTime(),fr,frNote;
  if(pub>0&&found>0&&found>=pub-5*60000){
    var h=(found-pub)/3600000;
    fr=h<=2?15:h<=6?12:h<=12?9:h<=24?5:2;
    frNote='Взяли через '+(h<1?Math.max(1,Math.round(h*60))+' мин':Math.round(h)+' ч')+' после выхода';
  }else{fr=10;frNote='Время выхода источника неизвестно';}
  parts.push({label:'Свежесть',short:'Свежесть',got:fr,max:15,note:frNote});

  var md=x.mediaKind||'none';
  var mPts={video:10,photo:8,generated:5,none:0}[md];if(mPts==null)mPts=0;
  parts.push({label:'Медиа',short:'Медиа',got:mPts,max:10,note:{video:'Видео',photo:'Фото источника',generated:'AI-обложка',none:'Нет медиа'}[md]||'Нет медиа'});

  var sc=Number(x.sourceCount)||0,role=String(x.sourceRole||''),sPts,sNote;
  if(sc>1){sPts=10;sNote='Подтверждено '+sc+' источниками';}
  else if(role==='official_primary'){sPts=10;sNote='Официальный источник';}
  else if(role==='media_context'){sPts=7;sNote='СМИ';}
  else if(role==='author_opinion'){sPts=5;sNote='Блогер / мнение автора';}
  else{sPts=6;sNote='Один источник';}
  parts.push({label:'Источник',short:'Источник',got:sPts,max:10,note:sNote});

  var total=parts.reduce(function(a,p){return a+p.got},0);
  var grade=total>=80?{label:'Отлично',cls:'g1'}:total>=65?{label:'Хорошо',cls:'g2'}:total>=50?{label:'Средне',cls:'g3'}:{label:'Слабо',cls:'g4'};
  return {total:total,grade:grade,parts:parts};
}

// Maps a queue item to the rating input (same mapping as the admin queue card).
export function queueItemRatingInput(q) {
  q = q || {};
  const storyCount = (q.storySources && q.storySources.length) || (q.storyCluster && q.storyCluster.sourceCount) || 0;
  const sourceImage = q.enhancedImageUrl || q.imageUrl || q.originalImageUrl || "";
  return {
    editorialV2: q.editorialV2 || {},
    aiScore: q.aiScore,
    qcStatus: q.qcStatus,
    status: q.status,
    articlePublishedAt: q.articlePublishedAt,
    foundAt: q.createdAt,
    mediaKind: q.videoUrl ? "video" : (sourceImage ? "photo" : (q.generatedImageUrl ? "generated" : "none")),
    sourceRole: q.sourceRole,
    sourceCount: storyCount
  };
}
