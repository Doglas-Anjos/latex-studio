import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AuthCard } from '../components/auth-card';
import { Button } from '../components/button';
import { Form } from '../components/form';
import { useService } from '../di/service-provider';
import { ApiError } from '../services/api-client';
import { AuthServiceToken, type RegisterInput } from '../services/auth.service';

function registerErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  }
  if (error instanceof ApiError && error.status === 400) return error.message;
  return 'Não foi possível cadastrar. Tente novamente.';
}

export function RegisterPage() {
  const auth = useService(AuthServiceToken);
  const register = useMutation({
    mutationFn: (input: RegisterInput) => auth.register(input),
  });

  if (register.isSuccess) {
    return (
      <AuthCard title="Cadastro recebido">
        <p>Cadastro recebido. Um administrador vai aprovar sua conta.</p>
        <p className="auth-alt">
          <Link to="/login">Voltar para o login</Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Criar conta">
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          register.mutate({
            email: String(data.get('email')),
            name: String(data.get('name')),
            password: String(data.get('password')),
          });
        }}
      >
        <Form.Field label="Nome" name="name" autoComplete="name" required />
        <Form.Field label="E-mail" name="email" type="email" autoComplete="email" required />
        <Form.Field
          label="Senha"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        {register.isError && <Form.Error>{registerErrorMessage(register.error)}</Form.Error>}
        <Button variant="primary" type="submit" disabled={register.isPending}>
          Cadastrar
        </Button>
      </Form>
      <p className="auth-alt">
        Já tem conta? <Link to="/login">Entrar</Link>
      </p>
    </AuthCard>
  );
}
