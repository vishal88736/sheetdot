declare namespace CustomFunctions {
  interface Invocation {
    address?: string;
    setResult?: (value: string | number | boolean) => void;
    onCanceled?: () => void;
  }

  function associate(id: string, func: (...args: any[]) => any): void;
}
