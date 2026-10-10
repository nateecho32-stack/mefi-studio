// Room images are read through the authenticated host bridge only after a click.
// A local re-encode drops camera/file metadata before the review and upload.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el=document.createElement(tag); if(cls)el.className=cls; if(text!=null)el.textContent=text; return el; };
  const button = (label,run) => { const el=node("button","ghost rooms-button",label); el.type="button";el.addEventListener("click",run);return el; };
  const reasons = { unsupported:"Image sharing is not available on this room service yet.", "image-expired":"This image has expired or was removed.", "not-member":"You no longer have access to this room.", "image-limit":"Image limit reached. Try again later.", "image-storage-full":"Image storage is full. Try again later.", "links-not-allowed":"New room members can share images after their first day.", "images-paused":"Image sharing is temporarily paused.", "invalid-image":"Choose a smaller JPEG or PNG image." };
  let reviewing=false;
  const enabled=()=>{try{return localStorage.getItem("mefiStudio.social.images")!=="off";}catch{return true;}};
  function dimensions(bytes) {
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(bytes.length>=24 && view.getUint32(0)===0x89504e47 && view.getUint32(4)===0x0d0a1a0a && view.getUint32(12)===0x49484452)return {width:view.getUint32(16),height:view.getUint32(20)};
    if(bytes[0]!==255 || bytes[1]!==216)return null;
    for(let at=2;at+4<=bytes.length;) {
      if(bytes[at++]!==255)return null;
      while(bytes[at]===255)at++;
      const marker=bytes[at++];if(marker===218||marker===217)return null;
      const size=view.getUint16(at);if(size<2||at+size>bytes.length)return null;
      if([192,193,194].includes(marker))return size>=8 ? {width:view.getUint16(at+5),height:view.getUint16(at+3)} : null;
      at+=size;
    }
    return null;
  }
  async function prepare(file) {
    if(!file || !["image/png","image/jpeg"].includes(file.type) || file.size>12*1024*1024)throw new Error("Choose a JPEG or PNG smaller than 12 MB.");
    const size=dimensions(new Uint8Array(await file.arrayBuffer()));
    if(!size || size.width<1 || size.height<1 || size.width*size.height>16_000_000)throw new Error("Choose an image with at most 16 million pixels.");
    const bitmap=await window.createImageBitmap(file,{imageOrientation:"from-image"});
    try {
      const canvas=document.createElement("canvas");let scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
      for(let pass=0;pass<8;pass++) {
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const uri=canvas.toDataURL("image/jpeg",Math.max(.4,.85-pass*.08));
        if(uri.startsWith("data:image/jpeg;base64,") && uri.length-23<=131072)return uri.slice(23);
        scale*=.8;
      }
      throw new Error("This image is too detailed. Crop it or choose a smaller one.");
    } finally {bitmap.close();}
  }
  function choose(roomId,roomName) {
    if(reviewing || !enabled())return;
    const input=node("input");input.type="file";input.accept="image/jpeg,image/png";
    input.addEventListener("change",async()=>{
      if(!input.files?.[0] || reviewing)return; reviewing=true;
      const dialog=node("dialog","room-image-review"),returnTo=document.activeElement;
      const status=node("p","muted","Preparing a private copy…");status.setAttribute("role","status");
      const close=()=>{dialog.close();dialog.remove();reviewing=false;returnTo?.focus?.();};
      dialog.setAttribute("aria-label",`Share an image to ${roomName}`);
      dialog.append(node("h2","",`Share to ${roomName}`),status,button("Cancel",close));document.body.append(dialog);dialog.showModal();
      dialog.addEventListener("cancel",event=>{event.preventDefault();close();});
      try {
        const jpeg=await prepare(input.files[0]);if(!dialog.isConnected)return;
        const preview=node("img","room-image-preview");preview.src=`data:image/jpeg;base64,${jpeg}`;preview.alt="Your image before sharing";
        const caption=node("textarea","rooms-compose");caption.maxLength=2000;caption.placeholder="Add a caption (optional)";caption.setAttribute("aria-label","Image caption");
        status.textContent="Filename and camera metadata are removed. Check the picture itself for faces, addresses, private chats, keys or other details you don't want to share. Room members can save copies; the service keeps images for seven days and reported evidence for 30 days.";
        const receipt=crypto.randomUUID().replaceAll("-","");let sentCaption=null;
        const share=button("Share image",async()=>{
          if(share.disabled)return;
          const checked=window.MefiSocialContent?.checkPost?.(caption.value);if(checked && !checked.ok){status.textContent=checked.reason;return;}
          // A retry has identical terms, so it cannot accidentally create two posts.
          if(sentCaption===null)sentCaption=caption.value;caption.disabled=true;share.disabled=true;
          try {
            const answer=await window.mefiStudio?.hubRoom?.("sendImage",roomId,{jpeg,caption:sentCaption,receipt});
            if(!dialog.isConnected)return;
            if(answer?.ok){close();return;}
            status.textContent=reasons[answer?.error]||"Not shared. Retry checks the same post before sending another copy.";
          }catch{if(dialog.isConnected)status.textContent="Connection lost. Retry checks the same post before sending another copy.";}
          finally{share.disabled=false;}
        });
        dialog.append(preview,caption,share);
      }catch(error){if(dialog.isConnected)status.textContent=error.message||"The image could not be prepared.";}
    });
    input.click();
  }
  function card(reference,roomId,reportId=null) {
    if(!enabled())return node("span","muted","Images are turned off on this device.");
    const box=node("div","room-image-card"),status=node("span","muted",reportId?"Reported image · may contain sensitive or upsetting content":"Shared image · loads only when you choose");
    const show=button("Show image",async()=>{
      if(show.disabled)return;show.disabled=true;
      try {
        const answer=reportId ? await window.mefiStudio?.hubRoom?.("modReportImage",reportId) : await window.mefiStudio?.hubRoom?.("roomImage",roomId,reference.id);
        if(box.isConnected===false)return;
        if(!answer?.ok){status.textContent=reasons[answer?.error]||"The image could not be loaded.";show.disabled=false;return;}
        const img=node("img","room-image-preview");img.alt=reportId?"Reported image evidence":"Image shared in this room";img.width=answer.width;img.height=answer.height;img.src=`data:image/jpeg;base64,${answer.jpeg}`;
        img.addEventListener("error",()=>{img.remove();status.textContent="This image could not be displayed.";show.disabled=false;});
        const hide=button("Hide image",()=>{img.remove();hide.remove();show.disabled=false;});box.append(img,hide);status.textContent=reportId?"Private moderator evidence · retained for 30 days from its first report.":"Room members can save copies.";
      }catch{status.textContent="The image could not be loaded.";show.disabled=false;}
    });
    box.append(status,show);return box;
  }
  window.MefiRoomImages={choose,card,prepare,dimensions,reportCard:reportId=>card(null,null,reportId)};
})();
