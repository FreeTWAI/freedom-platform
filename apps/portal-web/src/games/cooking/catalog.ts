/** CK-3..5: original recipe identities and their actual playable operations. */
export const CATEGORIES = [
  {id:'taiwan',name:'台式小吃',description:'熟悉的街角香氣',color:'#efb95f'},
  {id:'japan',name:'日式料理',description:'把日常捏得剛剛好',color:'#e7a6a0'},
  {id:'italy',name:'義式餐桌',description:'麵、起司與一點浪漫',color:'#9cb6a0'},
  {id:'korea',name:'韓式料理',description:'鍋子一熱，就很熱鬧',color:'#dc9783'},
  {id:'world',name:'世界料理',description:'今天的餐桌沒有邊界',color:'#acabd2'},
  {id:'bakery',name:'烘焙甜點',description:'奶油香是最好的鬧鐘',color:'#e5b2c2'},
  {id:'drinks',name:'飲品甜品',description:'一口剛剛好的快樂',color:'#a7c9c4'},
  {id:'vegetables',name:'蔬食料理',description:'把顏色都端上桌',color:'#b5c69d'},
] as const;
export type CategoryId = typeof CATEGORIES[number]['id'];
export type Technique = 'slice'|'mix'|'knead'|'pan'|'boil'|'bake'|'pour'|'fold'|'plate';
export type Shape = 'greens'|'carrot'|'meat'|'rice'|'dough'|'noodle'|'egg'|'fruit'|'cream'|'chocolate'|'fish';
export type Direction = 'left'|'right'|'up'|'down';
export const TECHNIQUES:Record<Technique,{name:string;hint:string}>={
  slice:{name:'切一切',hint:'沿虛線拖過食材。空白鍵也能切一刀。'},
  mix:{name:'拌一拌',hint:'沿碗邊順時針繞圈，也可以按「攪拌一圈」。'},
  knead:{name:'揉一揉',hint:'按住麵糰，等圓圈進入金色區，再放開。'},
  pan:{name:'煎炒',hint:'保持綠色火力，進度到金色區時翻面。'},
  boil:{name:'咕嚕煮',hint:'調好火力，看到泡沫就撈掉，讓湯慢慢煮好。'},
  bake:{name:'烘烤',hint:'調好烤箱溫度，進度進入金色區就出爐。'},
  pour:{name:'倒入',hint:'按住倒入，份量進入金色區後放開。'},
  fold:{name:'包起來',hint:'照提示方向滑動，或按方向鍵把食材包好。'},
  plate:{name:'擺盤',hint:'把食材拖到光圈裡。也能點食材，再點盤子。'},
};
export type CookingStep={kind:Technique;title:string;ingredient:string;shape:Shape;goal:number;durationMs:number;heat:number;holdMs:number;target:number;directions:Direction[]};
export type Recipe={id:string;name:string;category:CategoryId;art:number;ingredients:string[];steps:CookingStep[];difficulty:1|2|3;estimatedSeconds:number};
function step(kind:Technique,title:string,ingredient:string,shape:Shape,extra:Partial<CookingStep>={}):CookingStep{
  return {kind,title,ingredient,shape,goal:3,durationMs:7000,heat:58,holdMs:750,target:.7,directions:['left','right','up'],...extra};
}
const cut=(ingredient:string,shape:Shape='greens',goal=6)=>step('slice',`切好${ingredient}`,ingredient,shape,{goal});
const mix=(ingredient:string,shape:Shape='cream',goal=3)=>step('mix',`拌勻${ingredient}`,ingredient,shape,{goal});
const knead=(ingredient:string,goal=4)=>step('knead',`揉好${ingredient}`,ingredient,'dough',{goal});
const pan=(ingredient:string,shape:Shape='rice',heat=58)=>step('pan',`煎炒${ingredient}`,ingredient,shape,{heat});
const boil=(ingredient:string,shape:Shape='noodle',heat=70)=>step('boil',`煮好${ingredient}`,ingredient,shape,{heat,goal:2,durationMs:8000});
const bake=(ingredient:string,shape:Shape='dough',heat=50)=>step('bake',`烤香${ingredient}`,ingredient,shape,{heat});
const pour=(ingredient:string,shape:Shape='cream',target=.7)=>step('pour',`倒入${ingredient}`,ingredient,shape,{target,durationMs:3000});
const fold=(ingredient:string,directions:Direction[]=['left','right','up'])=>step('fold',`包好${ingredient}`,ingredient,'dough',{goal:directions.length,directions});
const plate=(ingredient:string,shape:Shape='greens',goal=3)=>step('plate',`擺上${ingredient}`,ingredient,shape,{goal});
function recipe(id:string,name:string,category:CategoryId,art:number,ingredients:string[],steps:CookingStep[],difficulty:1|2|3=1):Recipe{
  const estimatedSeconds=steps.reduce((sum,s)=>sum+(['pan','boil','bake'].includes(s.kind)?s.durationMs/1000:s.kind==='knead'?s.goal*1.5:s.kind==='slice'?s.goal*1.1:s.kind==='mix'?s.goal*2:6)+3,0);
  return {id,name,category,art,ingredients,steps,difficulty,estimatedSeconds:Math.ceil(estimatedSeconds/5)*5};
}
export const RECIPES:readonly Recipe[]=[
  recipe('egg-fried-rice','黃金蛋炒飯','taiwan',0,['白飯','雞蛋','蔥','紅蘿蔔'],[cut('蔥花與紅蘿蔔','carrot'),pan('蛋炒飯'),plate('蔥花')]),
  recipe('braised-pork-rice','滷肉飯','taiwan',1,['豬肉','白飯','醬油','青菜'],[cut('滷肉','meat',5),boil('香滷肉','meat'),plate('滷肉與青菜','meat')],2),
  recipe('pearl-milk-tea','珍珠奶茶','taiwan',2,['珍珠','鮮奶','紅茶'],[boil('黑糖珍珠','rice'),pour('鮮奶'),mix('紅茶與珍珠','cream',2)]),
  recipe('oyster-omelette','蚵仔煎','taiwan',3,['鮮蚵','雞蛋','青菜','粉漿'],[mix('雞蛋與粉漿','egg'),pan('蚵仔煎','egg',54),plate('醬汁與青菜')],2),
  recipe('scallion-pancake','蔥油餅','taiwan',4,['麵糰','蔥','油'],[cut('蔥花'),knead('蔥香麵糰'),pan('蔥油餅','dough'),cut('酥脆蔥油餅','dough',6)],2),
  recipe('popcorn-chicken','鹽酥雞','taiwan',5,['雞肉','地瓜粉','九層塔'],[cut('雞肉','meat'),mix('雞肉與地瓜粉','meat'),pan('鹽酥雞','meat',72),plate('九層塔')],2),
  recipe('taiwan-fish-cake','甜不辣','taiwan',6,['魚漿','白蘿蔔','醬汁'],[knead('魚漿',3),pan('甜不辣','fish',62),pour('甜辣醬','cream',.62)]),
  recipe('beef-noodle-soup','紅燒牛肉麵','taiwan',7,['牛肉','麵條','青江菜','蔥'],[cut('牛肉塊','meat',5),boil('牛肉高湯','meat'),boil('麵條','noodle'),plate('青江菜與蔥花')],3),

  recipe('salmon-sushi','鮭魚壽司','japan',0,['鮭魚','壽司飯','海苔'],[cut('鮭魚','fish',5),knead('壽司飯',3),plate('鮭魚','fish',4)],2),
  recipe('rice-balls','海苔飯糰','japan',1,['白飯','海苔','芝麻'],[mix('芝麻與白飯','rice',2),knead('飯糰',3),fold('海苔飯糰')]),
  recipe('tempura','蝦子天婦羅','japan',2,['蝦','麵粉','雞蛋'],[mix('天婦羅麵糊','cream'),pour('麵糊','cream',.65),pan('金黃蝦子','fish',68),plate('天婦羅','fish')],3),
  recipe('miso-soup','豆腐味噌湯','japan',3,['豆腐','味噌','海帶','蔥'],[cut('豆腐','dough',5),boil('味噌湯','cream',65),plate('海帶與蔥花')]),
  recipe('chicken-egg-bowl','親子丼','japan',4,['雞肉','雞蛋','洋蔥','白飯'],[cut('雞肉與洋蔥','meat'),pan('雞肉','meat',58),pour('蛋液','egg',.75),plate('海苔與蔥花')],2),
  recipe('japanese-curry','日式咖哩飯','japan',5,['咖哩','馬鈴薯','紅蘿蔔','白飯'],[cut('馬鈴薯與紅蘿蔔','carrot'),boil('濃咖哩','cream'),plate('咖哩與白飯','rice')]),
  recipe('rolled-omelette','玉子燒','japan',6,['雞蛋','高湯','海苔'],[mix('蛋液','egg',2),pan('玉子燒','egg',47),fold('金黃蛋捲',['right','left','right','up'])],3),
  recipe('tonkotsu-ramen','豚骨拉麵','japan',7,['麵條','叉燒','溏心蛋','高湯'],[boil('豚骨高湯','cream'),boil('拉麵','noodle'),cut('叉燒','meat',5),plate('叉燒與溏心蛋','egg',4)],2),

  recipe('margherita-pizza','瑪格麗特披薩','italy',0,['麵糰','番茄','莫札瑞拉','羅勒'],[knead('披薩麵糰'),pour('番茄醬','fruit'),plate('起司與羅勒','greens',4),bake('披薩','dough',65)],3),
  recipe('tomato-spaghetti','番茄義大利麵','italy',1,['義大利麵','番茄','蒜','羅勒'],[cut('番茄與蒜','fruit'),boil('義大利麵','noodle'),pan('番茄麵','noodle',55),plate('羅勒')],2),
  recipe('cream-risotto','奶油燉飯','italy',2,['米','奶油','蘑菇','起司'],[cut('蘑菇','dough',5),pan('米與奶油','rice',50),boil('燉飯','rice',62),plate('起司','cream')],2),
  recipe('lasagna','起司千層麵','italy',3,['麵皮','肉醬','起司','白醬'],[pan('番茄肉醬','meat'),pour('白醬'),fold('千層麵',['down','up','down','up']),bake('千層麵','dough',55)],3),
  recipe('italian-meatballs','義式肉丸','italy',4,['絞肉','洋蔥','番茄','香草'],[cut('洋蔥'),mix('肉丸餡','meat'),knead('肉丸',5),pan('番茄肉丸','meat',60)],2),
  recipe('roasted-vegetables','義式烤蔬菜','italy',5,['甜椒','櫛瓜','番茄','橄欖油'],[cut('甜椒與櫛瓜','carrot'),pour('橄欖油','cream',.6),bake('彩色蔬菜','greens',52)]),
  recipe('tiramisu','提拉米蘇','italy',6,['咖啡','馬斯卡彭','可可','手指餅乾'],[mix('馬斯卡彭','cream'),pour('咖啡','chocolate',.68),plate('可可與餅乾','chocolate',4)],2),
  recipe('pesto-pasta','青醬蝴蝶麵','italy',7,['蝴蝶麵','羅勒','松子','起司'],[cut('羅勒'),mix('青醬','greens'),boil('蝴蝶麵','noodle'),plate('松子與起司','cream')],2),

  recipe('bibimbap','韓式拌飯','korea',0,['白飯','紅蘿蔔','菠菜','雞蛋'],[cut('彩色配菜','carrot'),pan('配菜','greens'),plate('煎蛋與配菜','egg',5),mix('韓式拌飯','rice',2)],2),
  recipe('korean-pancake','海鮮煎餅','korea',1,['麵糊','蝦','蔥','魷魚'],[cut('蔥與海鮮','fish'),mix('煎餅麵糊','cream'),pan('海鮮煎餅','dough',57)],2),
  recipe('tteokbokki','辣炒年糕','korea',2,['年糕','韓式辣醬','魚板'],[cut('魚板','fish',5),boil('辣醬年糕','dough'),mix('辣炒年糕','dough',2)]),
  recipe('kimchi-fried-rice','泡菜炒飯','korea',3,['白飯','泡菜','雞蛋','海苔'],[cut('泡菜','carrot'),pan('泡菜炒飯','rice',64),plate('煎蛋與海苔','egg')]),
  recipe('gimbap','韓式紫菜包飯','korea',4,['白飯','海苔','小黃瓜','紅蘿蔔'],[cut('小黃瓜與紅蘿蔔','carrot'),plate('飯與配菜','rice',4),fold('紫菜包飯'),cut('紫菜飯捲','rice',7)],3),
  recipe('doenjang-soup','韓式大醬湯','korea',5,['大醬','豆腐','櫛瓜','菇'],[cut('豆腐與櫛瓜','dough'),boil('大醬湯','cream',68),plate('蔥花')]),
  recipe('korean-fried-chicken','韓式炸雞','korea',6,['雞肉','麵粉','蜂蜜','辣醬'],[mix('炸雞粉','cream',2),pan('韓式炸雞','meat',70),pour('蜂蜜辣醬','chocolate',.72),mix('裹醬炸雞','meat',2)],2),
  recipe('bulgogi','韓式烤肉','korea',7,['牛肉','洋蔥','醬油','生菜'],[cut('牛肉','meat',7),mix('烤肉醃料','meat'),pan('韓式烤肉','meat',66),plate('生菜','greens',4)],2),

  recipe('beef-tacos','墨西哥塔可','world',0,['玉米餅','牛肉','番茄','生菜'],[cut('番茄與生菜','fruit'),pan('香料牛肉','meat',61),fold('塔可',['left','right','up']),plate('香菜')],2),
  recipe('cheeseburger','起司牛肉堡','world',1,['漢堡麵包','牛肉','起司','生菜'],[knead('漢堡肉',3),pan('牛肉排','meat',63),plate('起司與生菜','greens',4)]),
  recipe('fish-and-chips','炸魚薯條','world',2,['魚排','馬鈴薯','麵糊','檸檬'],[cut('馬鈴薯','carrot',7),mix('酥炸麵糊','cream'),pan('魚與薯條','fish',69),plate('檸檬','fruit')],2),
  recipe('steak-dinner','香煎牛排','world',3,['牛排','奶油','馬鈴薯','迷迭香'],[mix('香草奶油','cream',2),pan('牛排','meat',67),plate('馬鈴薯與迷迭香','greens')],2),
  recipe('fresh-spring-rolls','越南生春捲','world',4,['米紙','蝦','生菜','米線'],[cut('生菜'),boil('蝦與米線','fish',65),fold('米紙春捲',['left','right','up','up'])],2),
  recipe('seafood-paella','西班牙海鮮飯','world',5,['米','蝦','貝類','番茄'],[cut('番茄','fruit'),pan('番茄與米','rice',55),boil('海鮮燉飯','rice',68),plate('蝦與檸檬','fish',4)],3),
  recipe('butter-chicken','奶油咖哩雞','world',6,['雞肉','番茄','奶油','香料'],[cut('雞肉','meat'),pan('香料雞肉','meat',59),pour('奶油'),boil('奶油咖哩雞','meat',65)],2),
  recipe('club-sandwich','總匯三明治','world',7,['吐司','雞肉','雞蛋','生菜'],[cut('番茄與生菜','fruit'),pan('雞肉與煎蛋','egg',53),plate('三明治配料','greens',4),fold('總匯三明治',['down','up','right'])]),

  recipe('strawberry-cake','草莓鮮奶油蛋糕','bakery',0,['草莓','麵粉','雞蛋','鮮奶油'],[mix('海綿蛋糕糊','cream'),bake('蛋糕','dough',45),pour('鮮奶油','cream',.66),plate('草莓','fruit',4)],3),
  recipe('chocolate-brownie','巧克力布朗尼','bakery',1,['巧克力','奶油','雞蛋','麵粉'],[mix('巧克力麵糊','chocolate'),pour('布朗尼麵糊','chocolate',.76),bake('布朗尼','chocolate',40)],2),
  recipe('glazed-doughnuts','糖霜甜甜圈','bakery',2,['麵糰','糖霜','彩色糖粒'],[knead('甜甜圈麵糰'),pan('甜甜圈','dough',64),pour('糖霜','cream',.65),plate('彩色糖粒','fruit',5)],2),
  recipe('macarons','法式馬卡龍','bakery',3,['杏仁粉','蛋白','糖','奶油'],[mix('杏仁蛋白糊','cream',4),pour('馬卡龍麵糊','cream',.62),bake('馬卡龍','dough',35),plate('奶油夾餡','cream')],3),
  recipe('chocolate-cookies','巧克力餅乾','bakery',4,['麵粉','巧克力豆','奶油'],[mix('餅乾麵糰','dough'),knead('小餅乾',5),plate('巧克力豆','chocolate',5),bake('餅乾','dough',42)]),
  recipe('cupcakes','彩色杯子蛋糕','bakery',5,['麵粉','雞蛋','奶油','糖霜'],[mix('杯子蛋糕糊','cream'),pour('蛋糕糊','cream',.7),bake('杯子蛋糕','dough',45),plate('彩色奶油花','cream',4)],2),
  recipe('egg-tarts','金黃蛋塔','bakery',6,['塔皮','雞蛋','鮮奶','砂糖'],[knead('蛋塔皮',3),mix('蛋奶液','egg',2),pour('蛋奶液','egg',.75),bake('蛋塔','egg',55)],2),
  recipe('breakfast-waffles','莓果鬆餅','bakery',7,['麵粉','鮮奶','雞蛋','莓果'],[mix('鬆餅麵糊','cream'),pour('麵糊','cream',.67),pan('鬆餅','dough',50),plate('莓果','fruit',4)]),

  recipe('fruit-tea','繽紛水果茶','drinks',0,['紅茶','柳橙','蘋果','鳳梨'],[cut('新鮮水果','fruit',7),pour('紅茶','chocolate',.74),mix('水果茶','fruit',2)]),
  recipe('matcha-latte','抹茶拿鐵','drinks',1,['抹茶','鮮奶','熱水'],[mix('抹茶','greens',3),pour('溫牛奶','cream',.73),plate('奶泡','cream')]),
  recipe('yuzu-soda','柚子氣泡飲','drinks',2,['柚子','氣泡水','薄荷'],[cut('柚子片','fruit',5),pour('氣泡水','cream',.68),plate('薄荷與柚子','fruit')]),
  recipe('banana-smoothie','香蕉奶昔','drinks',3,['香蕉','鮮奶','優格'],[cut('香蕉','fruit',6),mix('香蕉奶昔','cream',3),pour('奶昔','cream',.78)]),
  recipe('hot-chocolate','棉花糖熱可可','drinks',4,['可可','鮮奶','棉花糖'],[boil('鮮奶','cream',55),mix('可可','chocolate',3),plate('棉花糖','cream',4)]),
  recipe('caramel-pudding','焦糖布丁','drinks',5,['雞蛋','鮮奶','砂糖','焦糖'],[mix('布丁液','egg'),pour('焦糖','chocolate',.6),bake('布丁','egg',35)],2),
  recipe('ice-cream-sundae','冰淇淋聖代','drinks',6,['冰淇淋','草莓','巧克力醬'],[knead('冰淇淋球',3),pour('巧克力醬','chocolate',.63),plate('草莓與糖粒','fruit',4)]),
  recipe('mango-shaved-ice','芒果雪花冰','drinks',7,['芒果','雪花冰','煉乳'],[cut('芒果','fruit',8),plate('芒果丁','fruit',5),pour('煉乳','cream',.66)]),

  recipe('garden-salad','彩虹花園沙拉','vegetables',0,['生菜','番茄','紅蘿蔔','玉米'],[cut('新鮮蔬菜','greens',8),mix('沙拉醬','cream',2),plate('彩虹蔬菜','greens',5)]),
  recipe('pumpkin-soup','奶香南瓜濃湯','vegetables',1,['南瓜','洋蔥','鮮奶'],[cut('南瓜','carrot',7),boil('南瓜濃湯','carrot',64),pour('鮮奶','cream',.63)]),
  recipe('baked-sweet-potato','奶油烤地瓜','vegetables',2,['地瓜','奶油','芝麻'],[cut('地瓜','carrot',5),bake('地瓜','dough',60),plate('奶油與芝麻','cream')]),
  recipe('avocado-toast','酪梨吐司','vegetables',3,['酪梨','吐司','番茄','檸檬'],[cut('酪梨','greens',7),pan('吐司','dough',43),plate('酪梨與番茄','greens',4)]),
  recipe('mushroom-risotto','野菇燉飯','vegetables',4,['米','蘑菇','洋蔥','蔬菜高湯'],[cut('野菇與洋蔥','dough'),pan('野菇','dough',52),boil('野菇燉飯','rice',63),plate('香草')],2),
  recipe('vegetable-skewers','香烤彩蔬串','vegetables',5,['甜椒','櫛瓜','蘑菇','玉米'],[cut('彩色蔬菜','carrot',8),plate('蔬菜串','greens',5),bake('蔬菜串','greens',55)]),
  recipe('wholegrain-rice-ball','五穀野菜飯糰','vegetables',6,['五穀飯','青菜','芝麻','海苔'],[mix('五穀飯與青菜','rice',2),knead('五穀飯糰',3),fold('海苔飯糰')]),
  recipe('plant-burger','香菇蔬菜堡','vegetables',7,['蘑菇','豆類','麵包','生菜'],[cut('蘑菇','dough'),mix('蔬菜漢堡餡','greens'),pan('蔬菜排','greens',56),plate('生菜與番茄','greens',4)],2),
];
const byId=new Map(RECIPES.map(r=>[r.id,r]));
export function recipeOf(id:unknown):Recipe|null{return typeof id==='string'?byId.get(id)??null:null;}
export const RECIPE_IDS=RECIPES.map(r=>r.id);
export function recipeSearch(recipe:Recipe,query:string){const terms=query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);const haystack=[recipe.name,...recipe.ingredients,...recipe.steps.map(s=>s.title),...recipe.steps.map(s=>TECHNIQUES[s.kind].name)].join(' ').normalize('NFKC').toLocaleLowerCase();return terms.every(term=>haystack.includes(term));}
export const COOKING_RULES={actionCooldownMs:120,maxSimulatedTickMs:1000,minCutDistance:.18,minStirRadius:.12,maxStirRadius:.48,maxStirDelta:.8,minHoldMs:180,plateRadius:.18,saveThrottleMs:750,maxSaveBytes:65536} as const;
