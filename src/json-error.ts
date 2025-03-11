export class JsonError extends Error {
  readonly data: any;
  constructor(json: any) {
    super(json.error);
    this.data = json;
  }

  toString() {
    return this.data;
  }
}
