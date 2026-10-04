// «Что там с деньгами?» has an approved channel-specific 100-point scale:
// utility 30 · impact 20 · credibility 20 · freshness 15 · specificity 10 · interest 5.
function moneyPostRating(x){
  var v2=x.editorialV2||{},signals=x.channelSignals||v2.channelSignals||{},parts=[];
  function sig(name,fallback){var n=Number(signals[name]);return Number.isFinite(n)?Math.max(0,Math.min(10,n)):fallback;}
  var imp=Number(v2.importance);
  var imp10=Number.isFinite(imp)?Math.max(0,Math.min(10,imp)):(Number.isFinite(Number(x.aiScore))?Math.max(0,Math.min(10,Number(x.aiScore)/10)):5);

  var utility=Math.round(sig("utility",imp10)*3);
  parts.push({label:"Польза человеку",short:"Польза",got:utility,max:30,note:"Практическая польза для личных денег"});

  var impact=Math.round(imp10*2);
  parts.push({label:"Масштаб влияния",short:"Масштаб",got:impact,max:20,note:"Насколько сильно изменение касается обычного человека"});

  var rounds=Number(v2.rounds)||0,verdict=String(v2.verdict||""),st=String(v2.status||"");
  var sc=Number(x.sourceCount)||0,role=String(x.sourceRole||""),cred=0,credNote="";
  if(st==="skip"||x.status==="editorial_skip"||verdict==="reject"||verdict==="fix_exhausted"){cred=0;credNote="Редакционная проверка не пройдена";}
  else if(sc>1){cred=20;credNote="Подтверждено "+sc+" независимыми источниками";}
  else if(role==="official_primary"){cred=20;credNote="Официальный первоисточник";}
  else if(role==="media_context"&&(st==="approved"||verdict==="pass")){cred=Math.max(13,17-rounds*2);credNote="Надёжное СМИ + фактчек";}
  else if(role==="author_opinion"&&(st==="approved"||verdict==="pass")){cred=8;credNote="Один авторский источник: для важных финансовых правил нужно подтверждение";}
  else if(st==="approved"||verdict==="pass"||x.qcStatus==="pass"){cred=14;credNote="Фактчек пройден, но первоисточник не официальный";}
  else{cred=8;credNote="Подтверждение ограничено";}
  parts.push({label:"Достоверность",short:"Факты",got:cred,max:20,note:credNote});

  var pub=new Date(x.articlePublishedAt||0).getTime(),ageH=pub>0?Math.max(0,(Date.now()-pub)/3600000):null;
  var durable=["taxes","income_benefits","money_howto"].includes(String(x.contentBucket||v2.contentBucket||""));
  var fresh,freshNote;
  if(ageH==null){fresh=5;freshNote="Время выхода неизвестно";}
  else if(ageH<=24){fresh=15;freshNote="До 24 часов";}
  else if(ageH<=36){fresh=12;freshNote=Math.round(ageH)+" ч: небольшой штраф за возраст";}
  else if(ageH<=48){fresh=8;freshNote=Math.round(ageH)+" ч: сильная тема ещё может победить свежую слабую";}
  else if(ageH<=72&&durable){fresh=4;freshNote=Math.round(ageH)+" ч: допускается только как долгоиграющая полезная тема";}
  else{fresh=0;freshNote=Math.round(ageH)+" ч: вышло за окно актуальности";}
  parts.push({label:"Актуальность",short:"Свежесть",got:fresh,max:15,note:freshNote});

  var text=[x.title,x.text,x.sourceOriginalTitle,x.sourceOriginalText].filter(Boolean).join(" ");
  var hasMoney=/(?:\d[\d\s.,]*\s?(?:₽|руб(?:\.|л(?:я|ей)?)?|%|п\.\s?п\.)|(?:ставк|курс|налог|выплат|пенси|зарплат)[^\n]{0,50}\d)/iu.test(text);
  var hasNumber=/\d/.test(text);
  var spec=hasMoney?10:(hasNumber?7:3);
  parts.push({label:"Конкретика и цифры",short:"Цифры",got:spec,max:10,note:hasMoney?"Есть сумма, ставка, процент или другая ключевая цифра":(hasNumber?"Есть конкретные числа":"Мало измеримой конкретики")});

  var interest=Math.round(Math.max(sig("discussion",2),sig("virality",2),sig("wow",2))*0.5);
  interest=Math.max(0,Math.min(5,interest));
  parts.push({label:"Интерес",short:"Интерес",got:interest,max:5,note:"Насколько материал хочется открыть, переслать или обсудить"});

  var total=parts.reduce(function(a,p){return a+p.got},0);
  var grade=total>=80?{label:"Отлично",cls:"g1"}:total>=70?{label:"Запасной",cls:"g2"}:total>=50?{label:"Слабо",cls:"g3"}:{label:"Не подходит",cls:"g4"};
  return {total:total,grade:grade,parts:parts};
}

// 100-point post rating. The same function lives in public/admin.html (the test
// checks both give identical results). Parts: importance 40, fact check 25,
// freshness 15, media 10, source 10.
export function postRating(x){
  x=x||{};
  if(String(x.channelId||"")==="money") return moneyPostRating(x);
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
export function queueItemRatingInput(q, channelId) {
  q = q || {};
  const storyCount = (q.storySources && q.storySources.length) || (q.storyCluster && q.storyCluster.sourceCount) || 0;
  const sourceImage = q.enhancedImageUrl || q.imageUrl || "";
  return {
    channelId: channelId || q.channelId || (q.editorialV2 && q.editorialV2.channelId) || "",
    editorialV2: q.editorialV2 || {},
    aiScore: q.aiScore,
    qcStatus: q.qcStatus,
    status: q.status,
    title: q.title || "",
    text: q.text || "",
    sourceOriginalTitle: q.sourceOriginalTitle || "",
    sourceOriginalText: q.sourceOriginalText || "",
    contentBucket: q.contentBucket || (q.editorialV2 && q.editorialV2.contentBucket) || "",
    channelSignals: q.channelSignals || (q.editorialV2 && q.editorialV2.channelSignals) || {},
    articlePublishedAt: q.articlePublishedAt,
    foundAt: q.createdAt,
    mediaKind: q.videoUrl ? "video" : (sourceImage ? "photo" : (q.generatedImageUrl ? "generated" : "none")),
    sourceRole: q.sourceRole,
    sourceCount: storyCount
  };
}
