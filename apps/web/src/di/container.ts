export type Token<T> = symbol & { readonly __type?: T };

export const createToken = <T>(name: string): Token<T> => Symbol(name) as Token<T>;

export class Container {
  private readonly instances = new Map<symbol, unknown>();

  register<T>(token: Token<T>, instance: T): this {
    this.instances.set(token, instance);
    return this;
  }

  get<T>(token: Token<T>): T {
    if (!this.instances.has(token))
      throw new Error(`No service registered for ${token.toString()}`);
    return this.instances.get(token) as T;
  }
}
