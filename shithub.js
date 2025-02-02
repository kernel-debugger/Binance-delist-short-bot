let start_offset = localStorage.node_offset * 1000; // if running on multiple vps instances
let MARGIN = 1470;
let time_end = 12;
let poll_int = 8000;
let new_rates = false;
let old_rates = false;
let shorts_open = false;
let lastChecked = 0;
let precision = {};
let leverages = [];
let pause_till = 0;
let clearMainTimer = ()=>{}
var codes  = JSON.parse(localStorage.ocodes || "[]"); // id of each announcement post, extracted directly from the announcements page
console.log("codes:", codes);
console.log("Node id", localStorage.node_offset)

function alert_usr(msg=['empty']) {//clears timmer.
    console.log("Sending message.",msg);
    clearMainTimer();
    let sms = msg.join("---");
    sms = "Node ID: "+localStorage.node_offset+" -- msg: "+sms
    fetch("https://www.example.net/sendEmail?sms="+sms)
}

function oldPrice(sym){
    sym = sym+'USDT'
    if(old_rates){
        let rt = old_rates.find(rt=> rt.symbol==sym)
        rt = rt ? parseFloat(rt.price) : false;
        return rt
    }
    else
        return 0
}

function newPrice(sym){
    sym = sym+'USDT'
    if(new_rates){
        let rt = new_rates.find(rt=> rt.symbol==sym)
        rt = rt ? parseFloat(rt.price) : 0;
        return rt
    }
    else
        return 0
}

function priceChange(sym){
        let old_price = oldPrice(sym)
        let new_price = newPrice(sym)
        return old_price ? ((new_price - old_price)/old_price)*100 : 0;
}

// Custom timer
function intervalTimer(callback, interval = 500) {
  let counter = 1;
  let timeoutId;
  const startTime = Date.now();

  function main() {
    const nowTime = Date.now();
    const nextTime = startTime + counter * interval;
    timeoutId = setTimeout(main, interval - (nowTime - nextTime));
    counter += 1;
    callback();
  }

  timeoutId = setTimeout(main, interval);

  return () => {
    clearTimeout(timeoutId);
  };
}

function resetInterval(){
    console.log("Resetting interval from:", poll_int,new Date())
    clearMainTimer();
    setTimeout(()=>{
        poll_int += 500;
        clearMainTimer = intervalTimer(checkRates,poll_int);
    },(6*60*1000)-100);
}

function checkList(){
    
    fetch("https://www.binance.com/en/support/announcement/delisting?c=161&navId=161").then(t=>{
        if(t.status==429){
            resetInterval();
            throw new Error(`429 web error! backing off.`);
        }
        else if(t.status==202){
            
            pause_till = (new Date() * 1 ) + 606000; // 10 minutes pause
//            alert_usr(["ERROR 202, Manually REFRESH TOKEN"])
            throw new Error(`Error 202...`);
        }
        else if(t.status==200){
            return t.text();
        }
        else{
            throw new Error(`Unknown error...`,t.status);
        }
    }).then(html=>{

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const el = doc.getElementById('__APP_DATA');
        if(!el){
            alert_usr(["App data missing."]);
            console.log(doc);
            return false;
        }
        let jsn = JSON.parse(el.innerHTML);

        let art  = jsn.appState.loader.dataByRouteId.d34e.catalogDetail.articles;
    
        art.forEach(ar=>{
            if(codes.indexOf(ar.code) == -1){

                if(ar.title.indexOf("Binance Will Delist")==0 && ar.title.indexOf(" on ")!=-1 && ar.title.indexOf("Margin")==-1 && shorts_open==false){
                    coins = ar.title.replace(" and "," ").split("Will Delist")[1].split(" on ")[0].split(",");
                    //coins = ["APT", "SAFE","NULS"];
                    selectNshort(coins);
                    shorts_open=true;

                }
                else if(ar.title.indexOf("Binance Futures Will Delist USDⓈ-M")==0 &&  ar.title.indexOf("Margin")==-1 &&  ar.title.indexOf("Perpetual Contracts")!=-1 && shorts_open==false){
                    coins = ar.title.replace(" and "," ").split("Will Delist USDⓈ-M")[1].split("Perpetual Contracts")[0].split(",");
                    selectNshort(coins);
                    shorts_open=true;

                }
                codes.push(ar.code);
                localStorage.ocodes = JSON.stringify(codes);
            }
        });
        lastChecked = new Date();
 
    }).catch(c=>{
        console.log("Error: ",c, new Date())
    });
}

function checkRates(second=0){ // store rates

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentSek = now.getSeconds();

    if(currentHour > 0 && currentHour < time_end && pause_till < now){
        
        fetch("https://fapi.binance.com/fapi/v1/ticker/price").then(p=>{
            if(p.status != 200){
                alert_usr(["Price api error."]);
                throw new Error(`${p.status} api error! backing off.`);
            }
            return p.json()
        }).then(jsn=>{
            new_rates = jsn;
            setTimeout(()=>{old_rates = jsn},10000);
            checkList();
        }).catch(c=>{
            console.log("Error:"+c.message)
        });

        if(((currentHour==8 && currentMinute<3) || (currentHour==7 && currentMinute==59 && currentSek>48)) && second==0){ // possible time, double check
            setTimeout(checkRates,4500,1)
        }
    }

}

function getMaxLeverage(sym){
    let lv = leverages.find(lv=>lv.symbol==sym+"USDT")
    if(lv && lv.brackets && lv.brackets[0])
        return lv.brackets[0].initialLeverage
    else
        return false;
}


 function getoptLeverage(symbol, margin) {
    
        const brackets = leverages.find(bracket => bracket.symbol === symbol+"USDT");

        let pos_size = 0;
        let optLeverage = 0;

        // Iterate over each leverage bracket
        for (const bracket of brackets.brackets) {
            const { notionalCap, initialLeverage } = bracket;

            // Calculate position size for this leverage level
            const maxPositionForLeverage = Math.min(margin * initialLeverage, notionalCap);

            if (maxPositionForLeverage > pos_size) {
                pos_size = maxPositionForLeverage;
                optLeverage = initialLeverage;
            }
        }

        return {
            optLeverage,
            pos_size
        };
}

async function selectNshort(coins){

    alert_usr(coins)

    const now = new Date();
    if( (lastChecked*1 + poll_int + 10000) < now){
        console.log("Delist out of time, not shorting.", new Date())
        return false;
    }

    let odds = await getOpenPositions(); //50ms

    if(odds.length){
        console.log("Orders Already exist", new Date());
        return false;
    }

    console.log("Shorting coins...", coins, new Date());

    coins = coins.map(c => c.trim().replace("USDT",""));

    coins = coins.filter(sym=>newPrice(sym)); // make sure it's there

    coins = coins.sort((sym1,sym2)=>{ // sort max size possible in desc order

        let c1 = getoptLeverage(sym1,MARGIN).pos_size
        let c2 = getoptLeverage(sym2,MARGIN).pos_size
        return c2 - c1
    });

    let coins_cp = [...coins];
    
    coins = coins.filter(sym=>{ // remove if change > 5% in last 8 sec

        let change= priceChange(sym);
        console.log(sym+" change is: "+change);
        return Math.abs(change)<5
    })

    coins = coins.slice(0,3);

    console.log("Short finalist: ",coins);

    let ln = coins.length

    if(ln){
        let poses = []; // 10 , 5, 3

        coins.forEach(sym=>{
            poses.push(getoptLeverage(sym,MARGIN).pos_size)
        });

        let sum = poses.reduce((a,b)=>a+b)

        poses = poses.map(p => parseInt((p/sum) * MARGIN))

        //let pos_margin = parseInt(MARGIN/ln);
        coins.forEach((sym,ix)=>{
            openShortPosition(sym,poses[ix]);         
        })
    }

    else if(coins_cp.length){// no coin match filter, short min lev

        let min_sym = coins_cp[coins_cp.length-1]
        if(priceChange(min_sym)<8)
            openShortPosition(min_sym,parseInt(MARGIN/2));
        else
            console.log("no coins < 8%")
    }
    else{
        console.log("garbage input.")
    }
}

fetch("https://fapi.binance.com/fapi/v1/exchangeInfo").then(r=>r.json()).then(jsn=>{
    jsn.symbols.forEach(sym=>{
        let fl = sym.filters.find(fl=>fl.filterType=="PRICE_FILTER")
        fl = parseFloat(fl.tickSize)
        precision[sym.symbol] = -Math.log10(fl)
    });
});


/////////////////////////////////

const API_KEY = 'blablabla';
const API_SECRET = 'blablabla';
const BASE_URL = 'https://fapi.binance.com';

async function generateSignature(queryString, secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: { name: "SHA-256" } },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(queryString)
    );
    return Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

async function signQuery(data) {
    const queryString = new URLSearchParams(data).toString();
    const signature = await generateSignature(queryString, API_SECRET);
    return `${queryString}&signature=${signature}`;
}

async function sendRequest(endpoint, data = null, meth="POST") {
    const headers = {
        'X-MBX-APIKEY': API_KEY
    };

    const url = data
        ? `${BASE_URL}${endpoint}?${await signQuery(data)}`
        : `${BASE_URL}${endpoint}`;

    const response = await fetch(url, {
        method: meth,
        headers
    })

    return response.json();
}

async function getOpenPositions() {

    let orderData = {
        timestamp: Date.now()
    };
    let positions = await sendRequest('/fapi/v2/positionRisk', orderData, "GET");
    positions = positions.filter(pos => parseFloat(pos.positionAmt) !== 0);
    return positions;
}

async function openShortPosition(sym,pos_margin) {

    let price = newPrice(sym);

    let {optLeverage,pos_size} = getoptLeverage(sym,pos_margin);

    pos_size -= 400; //  price may have decreased further in 100ms

    let qty = parseInt(pos_size/price);

    let shortPrice = price*.98;

    shortPrice = shortPrice.toFixed(precision[sym+"USDT"]);

    try {

        let lev_data = {
                symbol: sym+'USDT',
                leverage: optLeverage,
                timestamp: Date.now()
        };
        await sendRequest('/fapi/v1/leverage', lev_data); // delay 50ms

        let orderData = {
            symbol: sym+'USDT',
            side: 'SELL',
            type: 'LIMIT',
            price: shortPrice,
            timeInForce: "GTC",
            quantity: qty, 
            timestamp: Date.now()
        };
        let orderResult = await sendRequest('/fapi/v1/order', orderData);

        if(orderResult.code == -2019 || orderResult.code == -2027){ // insufficient margin, max size error, reduce size

            console.log("insufficient margin, retyring.", orderResult.code)
            qty = parseInt(0.8*pos_size/price);
            orderData.quantity = qty
            orderData.timestamp = Date.now();
            orderResult = await sendRequest('/fapi/v1/order', orderData);
        }

        if(orderResult.code){//
            console.log("failed to place order after multiple attempts.")
            return false;
        }

        console.log('Order successful:', orderResult);

        setTimeout(async ()=>{//sl after 1min delay

            let positions = await getOpenPositions();

            if(positions.find(ord=>ord.symbol==sym+"USDT") == undefined){ // make sure the pos is open, cancel order otherwise

                console.log("Order doesnt exist, not placing SL, cancelling open order");

                cancelData = {
                    symbol: sym+"USDT",
                    orderId: orderResult.orderId,
                    timestamp: Date.now()
                }

                let cancelRes = await sendRequest('/fapi/v1/order', cancelData, 'DELETE');

                return false;
            }

            let stopPrice = price;
            stopPrice = stopPrice.toFixed(precision[sym+"USDT"])

            let stopLossParams = {
                    symbol: sym+'USDT',
                    side: "BUY",
                    type: "STOP_MARKET",
                    stopPrice: stopPrice, // Calculated stop loss price
                    quantity: qty,
                    timestamp: Date.now(),
            };
            let orderResult2 = await sendRequest('/fapi/v1/order', stopLossParams);

            if(orderResult2.code == -2021){// if failed close immedietly.
                console.log("closing order immedietly.")
                stopLossParams = {
                        symbol: sym+'USDT',
                        side: "BUY",
                        type: "MARKET",
                        quantity: qty,
                        timestamp: Date.now(),
                };
                orderResult2 = await sendRequest('/fapi/v1/order', stopLossParams);
            }
            console.log('sl successfull:', orderResult2);
        },60000);

    } catch (error) {
        console.log('Error placing order:', error);
    }
}

function update_leverages(){//check levg per 2 min

    sendRequest('/fapi/v1/leverageBracket', {
            timestamp: Date.now()
        },'GET').then(dt=>{
            leverages = dt
        })
}

// Init

let lvg_int = setInterval(update_leverages,120000);

update_leverages();

init = ()=>{

    if(isNaN(start_offset)){
        console.log("Offset not found.")
        return false;
    }

    if(codes.length){
        
        let nw = new Date().getSeconds()*1000 + new Date().getMilliseconds();
        setTimeout(()=>{

            clearMainTimer = intervalTimer(checkRates,poll_int);

            console.log("Tracking started.",new Date(), new Date().getMilliseconds())

        }, 60000-nw+start_offset);
    }
    else{
        console.log("No codes exist.")
    }
}

init();