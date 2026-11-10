// HTTP 层用的错误类型：路由只负责抛，server.mjs 统一映射成状态码。
// 以前「key 不存在」被当成参数错误回 400，方法不匹配一半 404 一半 405，
// 这里把状态收拢到一处。

export class HttpError extends Error {
  constructor(status, message, { field = "", kind = "", headers = {} } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.field = field;
    this.kind = kind;
    this.headers = headers;
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "没有这个资源", options = {}) {
    super(404, message, options);
    this.name = "NotFoundError";
  }
}

export class MethodNotAllowedError extends HttpError {
  constructor(allow = "", message = "方法不允许") {
    super(405, message, { headers: allow ? { Allow: allow } : {} });
    this.name = "MethodNotAllowedError";
  }
}
