import biliWorker from "./worker.js";

export default {
  async fetch(request, env, ctx) {
    const { searchParams, pathname } = new URL(request.url);
    let url = searchParams.get("url");
    if (pathname === "/bilibili") {
      const target = new URL(request.url);
      target.pathname = "/v2";
      return biliWorker.fetch(new Request(target, request), env, ctx);
    }

    if (url != null) {
      try {
        if (url.includes("youtube") || url.includes("youtu.be")) {
          // 暂不支持 YoutTube 的云端解析
          return new Response("YoutTube is not supported");
        }
        else if (url.includes("bilibili") || url.includes("b23.tv")) {
          const json = await parseFromBiliResolver(url);
          if (json != null) {
            return Response.json(json);
          }
        }
        else if (url.includes("xhslink")) {
          const json = await parseXHSFromTikhub(url, env);
          if (json != null) {
            return Response.json(json);
          }
        }
        else if (url.includes("douyin")) {
          const json = await parseDouyinFromTikhub(url, env);
          if (json != null) {
            return Response.json(json);
          }
        }
        else if (url.includes("soundgasm")) {
          const json = await parseSoundgasmFromCatchV(url);
          if (json != null) {
            return Response.json(json);
          }
        }

        try {
          const json = await parseFromCobalt("https://aisten-cobalt2.zeabur.app/", url);
          console.log(json);
          if (json != null) {
            return Response.json(json);
          }
        } catch (error) {
          console.log("parseFromCobalt error", error)
        }

        try {
          const response = await fetch(`https://aisten-parser.zeabur.app/parse/videodl?url=${url}`);
          const json = await response.json();

          if (json.url) {
            return Response.json(json);
          }
        } catch (error) {
          console.log("parse/videodl error", error)
        }

        const ytRe = await fetch(`https://aisten-parser.zeabur.app/parse?url=${url}`);
        const ytJSON = await ytRe.json();

        if (ytJSON.url) {
          return Response.json(ytJSON);
        }
      } catch (error) {
        console.log(error);
      }
    }

    return Response.json({ url });
  },
};

async function parseFromCobalt(apiURL, url) {
  const urlObject = new URL(url);
  const pathnames = urlObject.pathname.split("/");
  const id = pathnames.pop() || pathnames.pop();

  const response = await fetch(apiURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      url: url
    })
  });
  const responseJSON = await response.json();
  const responseURL = responseJSON.url;

  if (responseURL != null) {
    return {
      title: id,
      url: responseURL
    }
  }
}

async function parseXHSFromTikhub(url, env) {
  const apiURLV2 = `https://api.tikhub.io/api/v1/xiaohongshu/app_v2/get_video_note_detail?share_text=${url}`;
  const responseV2 = await fetch(apiURLV2, {
    headers: {
      "Authorization": `Bearer ${env.TIKHUB_API_KEY}`
    },
  });

  const responseJSONV2 = await responseV2.json();

  if (responseJSONV2 && responseJSONV2.code == 200) {
    const data = responseJSONV2.data.data[0];
    return {
      title: data.title,
      thumbnail: data.video_info_v2.image.thumbnail,
      url: data.video_info_v2.media.stream.h264[0].master_url,
    };
  }
}

async function parseDouyinFromTikhub(url, env) {
  const apiURL = `https://api.tikhub.io/api/v1/douyin/web/fetch_one_video_by_share_url?share_url=${url}`;
  const response = await fetch(apiURL, {
    headers: {
      "Authorization": `Bearer ${env.TIKHUB_API_KEY}`
    },
  });

  const responseJSON = await response.json();

  if (responseJSON && responseJSON.code == 200) {
    const aweme_detail = responseJSON.data.aweme_detail;
    return {
      title: aweme_detail.desc,
      thumbnail: aweme_detail.video.cover.url_list[0],
      url: aweme_detail.video.play_addr.url_list[0],
    };
  }
}

async function parseSoundgasmFromCatchV(url) {
  const api = `https://catchv.fooish.com/download-video?url=${url}`
  const response = await fetch(api);
  const responseJSON = await response.json();

  const video = responseJSON[0].videos[0];
  if (video) {
    return {
      title: responseJSON[0].title,
      url: video.url
    }
  }
}

async function parseFromBiliResolver(url) {
  const response = await fetch(`https://parse.aistenapp.top/api/any?text=${url}`);
  const responseJSON = await response.json();
  if (responseJSON.status === "success") {
    return {
      title: responseJSON.title,
      thumbnail: responseJSON.pic,
      url: responseJSON.url,
    }
  }
}