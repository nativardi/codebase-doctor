create table users (
  id serial primary key,
  email text not null unique,
  password_hash text not null,
  role text not null default 'customer',
  created_at timestamptz not null default now()
);

create table orders (
  id serial primary key,
  user_id integer not null references users(id),
  total_cents integer not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table order_items (
  id serial primary key,
  order_id integer not null references orders(id),
  product_id integer not null,
  quantity integer not null
);
create index order_items_order_id_idx on order_items(order_id);
