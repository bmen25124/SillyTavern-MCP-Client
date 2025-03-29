export class JsonError extends Error {
  readonly data: any;
  constructor(json: any) {
    super(json.error);
    this.data = json;
  }

  toString() {
    if (typeof this.data === 'object' && this.data !== null) {
      return JSON.stringify(this.data, null, 2);
    }
    return String(this.data);
  }
}
