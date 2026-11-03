import {parseProgress,QUESTS,type Progress,type Quest} from './progress.js';
import {completeAnswers} from './scoring.js';
export type VillageStep='overview'|Quest;
export type VillageView={step:VillageStep;index:number;result:boolean};
export function resumeView(p:Progress,value?:unknown):VillageView {
  const first=p.answers.findIndex(a=>!a.length);
  const fallback:VillageView={step:'overview',index:first<0?0:first,result:p.done.includes('quiz')&&completeAnswers(p.answers)};
  if(!value||typeof value!=='object')return fallback;
  const v=value as Partial<VillageView>;
  return {step:v.step==='overview'||QUESTS.includes(v.step as Quest)?v.step!:fallback.step,index:Number.isInteger(v.index)&&v.index!>=0&&v.index!<15?v.index!:fallback.index,result:v.result===true&&completeAnswers(p.answers)};
}
export function restoreVillage(raw:string|null){
  const progress=parseProgress(raw);
  let view:unknown;try{if(raw&&raw.length<=50000)view=JSON.parse(raw)?.journey}catch{/* Defensive legacy parsing. */}
  return {progress,view:resumeView(progress,view)};
}
// Module-local interface copy; author questions and result examples remain Traditional Chinese.
const copy={
  leave:['本輪變更尚未保存，離開將遺失。請先複製備份。確定捨棄本輪變更並離開？','Unsaved changes will be lost. Copy a backup first. Discard this session’s changes and leave?','未保存の変更が失われます。先にコピーしてください。変更を破棄して離れますか？','저장되지 않은 변경 사항이 사라집니다. 먼저 복사하세요. 변경 사항을 버리고 나갈까요?','Se perderán los cambios no guardados. Copia un respaldo primero. ¿Descartar y salir?'],
  backup:['複製備份：展開後選取文字自行保存','Backup: expand and copy the text somewhere safe','バックアップ：開いて文章をコピーして保存','백업: 펼쳐서 내용을 복사해 보관하세요','Respaldo: abre y copia el texto en un lugar seguro'],
  unsaved:['尚未保存。離開、重新整理或關閉頁面可能遺失本輪變更；請先複製下方備份。','Not saved. Leaving, reloading or closing may lose these changes. Copy the backup below first.','未保存です。移動・再読み込み・終了で変更が失われる場合があります。先に下の内容をコピーしてください。','저장되지 않았습니다. 이동, 새로 고침, 종료 시 변경 사항이 사라질 수 있습니다. 아래 백업을 먼저 복사하세요.','Sin guardar. Al salir, recargar o cerrar puedes perder los cambios. Copia primero el respaldo de abajo.'],
  overview:['我的探索清單','My exploration','探索リスト','내 탐색 목록','Mi exploración'],
  purpose:['把興趣、生活安排與強項，整理成一件這週能試的小事。每一步都選填，不影響註冊或加入公會。','Turn your interests, schedule and strengths into one small experiment. Every step is optional; none is required to register or join a guild.','興味・暮らし・強みから今週試すことを一つ選びます。すべて任意で、登録やギルド参加の条件ではありません。','관심사, 생활과 강점으로 이번 주 작은 실험을 정리하세요. 모든 단계는 선택이며 가입 조건이 아닙니다.','Convierte intereses, horarios y fortalezas en un pequeño experimento. Todo es opcional; no es requisito para registrarte ni unirte a un gremio.'],
  start:['開始探索 · 15 題','Start · 15 questions','始める · 15問','시작 · 15문항','Empezar · 15 preguntas'],
  resume:['繼續上次作答','Continue answers','回答を続ける','이어서 답하기','Continuar respuestas'],
  estimate:['測驗約 5–8 分鐘，可隨時離開再繼續。','Allow about 5–8 minutes. You can leave and continue later.','目安は5〜8分。途中で離れて後で続けられます。','약 5–8분 소요됩니다. 나중에 이어서 할 수 있습니다.','Calcula 5–8 minutos. Puedes salir y continuar después.'],
  skip:['先逛公會，不做測驗','Browse guilds without the quiz','回答せずギルドを見る','설문 없이 길드 둘러보기','Ver gremios sin cuestionario'],
  back:['返回探索清單','Back to exploration','探索リストに戻る','탐색 목록으로','Volver a exploración'],
  nextCard:['把想法寫成方向卡','Write my direction card','方向カードを書く','방향 카드 쓰기','Escribir mi tarjeta'],
  cardHint:['先寫可投入的時間與不能犧牲的事，再選一件本週能完成的小行動。不必先做測驗。','Write the time you can give and what you cannot sacrifice, then one small action for this week. No quiz required.','使える時間と譲れないこと、今週の小さな行動を書きます。回答は不要です。','투자할 시간과 지킬 원칙, 이번 주 작은 행동을 적으세요. 설문은 필요 없습니다.','Escribe tu tiempo disponible, lo que no quieres sacrificar y una pequeña acción. No necesitas el cuestionario.'],
  saveCard:['完成方向卡，繼續探索','Finish card and explore','カードを完了して探索へ','카드 완료 후 탐색','Terminar tarjeta y explorar'],
  explored:['我已看過，之後再決定','I browsed; I will decide later','確認したので後で決める','확인했어요. 나중에 결정할게요','Ya miré; decidiré después'],
  checkinHint:['做過小行動後再回來：做了什麼？學到什麼？下一次想調整什麼？今天可以先略過。','Come back after trying your action: what did you do, learn and want to change? You can skip this today.','行動の後に戻り、やったこと・学び・次に変えたいことを書きます。今日は飛ばせます。','실행 후 돌아와 한 일, 배운 점, 바꿀 점을 적으세요. 오늘은 건너뛰어도 됩니다.','Vuelve después de probar: ¿qué hiciste, aprendiste y cambiarías? Puedes omitirlo hoy.'],
  saveCheckin:['記下回顧，返回清單','Finish reflection and return','振り返りを記録して戻る','회고 완료 후 목록으로','Terminar reflexión y volver'],
  details:['展開完整結果與計分說明','Full result and scoring details','結果と採点の詳細','전체 결과와 점수 설명','Resultado completo y puntuación'],
  local:['只在這個瀏覽器保存，不會同步到其他裝置；共用電腦上的其他使用者可能看到。','Saved only in this browser, not synced to other devices. Other people using this browser may see it.','このブラウザのみ保存。端末間同期はなく、共用する人に見える場合があります。','이 브라우저에만 저장되며 기기 간 동기화되지 않습니다. 공용 브라우저 사용자가 볼 수 있습니다.','Solo se guarda en este navegador, sin sincronización. Otras personas que lo usen podrían verlo.'],
  saved:['已保存到這個瀏覽器','Saved in this browser','このブラウザに保存済み','이 브라우저에 저장됨','Guardado en este navegador'],
  readFailed:['無法讀取本機紀錄；為避免蓋掉舊作答，本輪不會自動保存。可暫時操作；請先保留文字，再允許瀏覽器儲存並重新整理。','Could not read saved progress. To protect existing answers, this session will not auto-save. Keep a copy of your text before allowing storage and reloading.','記録を読めません。以前の回答を守るため自動保存しません。文章を控えてから保存を許可し、再読み込みしてください。','기록을 읽을 수 없어 기존 답변 보호를 위해 자동 저장하지 않습니다. 내용을 복사한 후 저장을 허용하고 새로 고침하세요.','No se pudo leer el progreso. Para proteger respuestas anteriores no se guardará automáticamente. Copia el texto antes de permitir almacenamiento y recargar.'],
  clearTitle:['確定清除這個瀏覽器的新手村紀錄？','Clear this browser’s village progress?','このブラウザの探索記録を消去しますか？','이 브라우저의 탐색 기록을 지울까요?','¿Borrar el progreso de este navegador?'],
  clearHint:['將清除 15 題作答、方向卡、回顧與勾選，無法復原。不會更動會員資料或公會資格。','This removes answers, your card, reflection and checkmarks and cannot be undone. Membership and guilds are unchanged.','回答・カード・振り返り・チェックを消去し、元に戻せません。会員情報やギルドには影響しません。','답변, 카드, 회고, 체크 표시가 삭제되며 복구할 수 없습니다. 회원 정보와 길드에는 영향이 없습니다.','Elimina respuestas, tarjeta, reflexión y marcas sin posibilidad de deshacer. No cambia tu membresía ni gremios.'],
  clearConfirm:['確認清除紀錄','Confirm clearing','消去する','삭제 확인','Confirmar borrado'],
  cancel:['取消，保留紀錄','Cancel, keep progress','キャンセルして保持','취소하고 유지','Cancelar y conservar'],
  clearFailed:['清除失敗，紀錄仍保留。請允許瀏覽器儲存後再試一次；目前沒有刪除任何畫面中的內容。','Clearing failed; progress is retained. Allow browser storage and try again. Nothing on this screen was removed.','消去できません。記録は保持しています。保存を許可して再試行してください。画面の内容は消していません。','삭제 실패로 기록이 유지됩니다. 저장을 허용하고 다시 시도하세요. 화면 내용은 지워지지 않았습니다.','No se pudo borrar; el progreso se conserva. Permite almacenamiento y vuelve a intentarlo. No se eliminó el contenido de la pantalla.'],
  cleared:['已清除這個瀏覽器的新手村紀錄。','Village progress cleared from this browser.','このブラウザの探索記録を消去しました。','이 브라우저의 탐색 기록을 삭제했습니다.','Progreso borrado de este navegador.'],
  selected:['目前步驟','Current step','現在の手順','현재 단계','Paso actual'],
  useAction:['採用這個行動，填寫方向卡','Use this action in my card','この行動でカードを書く','이 행동으로 카드 작성','Usar esta acción en mi tarjeta'],
  completed:['已勾選','Checked','チェック済み','체크됨','Marcado'],
  frameworkNext:['已閱讀，開始作答','Read; start questions','読んだので回答する','읽었어요. 답변 시작','Leído; empezar preguntas'],
} as const;
export function villageText(language:string,key:keyof typeof copy){return copy[key][({'zh-Hant':0,en:1,ja:2,ko:3,es:4} as Record<string,number>)[language]??0]}
