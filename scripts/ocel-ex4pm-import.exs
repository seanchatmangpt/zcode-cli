# Cross-validation: import a .jsonocel with ex4pm's Ex4pm.OCEL.normalize (loaded from source; no mix deps needed)
# and print event/object counts.   elixir scripts/ocel-ex4pm-import.exs <log.jsonocel>
root = System.get_env("EX4PM_ROOT", "/Users/sac/ex4pm/ex4pm")
Code.require_file(root <> "/lib/ex4pm/core.ex")
Code.require_file(root <> "/lib/ex4pm/ocel.ex")
[path] = System.argv()
count = fn c -> if is_map(c), do: map_size(c), else: length(c) end
case path |> File.read!() |> :json.decode() |> Ex4pm.OCEL.normalize() do
  {:ok, log} -> IO.puts("events=#{count.(log.events)} objects=#{count.(log.objects)}")
  other -> IO.inspect(other, limit: 5); System.halt(1)
end
