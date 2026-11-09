// 页面唯一的联网动作：把自己导航到插件的本地服务。
// magpie 页面不能 fetch、不能开子框架，但可以导航。
(() => {
  const said = document.getElementById("said");
  const say = (text) => {
    if (said) said.textContent = text;
  };

  const ready = (window.magpie && window.magpie.ready) || Promise.resolve({});

  ready
    .then(async () => {
      let port = 3478;
      try {
        const options = await window.magpie.options.get();
        const n = Number(options && options.port);
        if (Number.isInteger(n) && n > 0 && n < 65536) port = n;
      } catch {
        // 没有选项就用默认端口
      }
      // magpie web 时是经 magpie 反代的地址；桌面窗口里是空串，直连 127.0.0.1。
      const base = window.magpie.service || `http://127.0.0.1:${port}/`;
      say("正在打开管理界面…");
      location.replace(base);
    })
    .catch((err) => {
      say(`连接失败：${(err && err.message) || err}`);
    });
})();
