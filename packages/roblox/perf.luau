-- Performans kapısı: build edilmiş .rbxl dosyasında Part ve instance sayısı.
-- Kullanım: lune run perf.luau <dosya.rbxl> [maxParts]
-- Çıktı tek satır JSON; Part sayısı eşiği aşarsa çıkış kodu 1.
local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")

local path = process.args[1]
local maxParts = tonumber(process.args[2]) or 20000
if not path then
	print("kullanım: lune run perf.luau <dosya.rbxl> [maxParts]")
	process.exit(2)
end

local game = roblox.deserializePlace(fs.readFile(path))
local instances, parts = 0, 0
for _, inst in game:GetDescendants() do
	instances += 1
	if inst:IsA("BasePart") then
		parts += 1
	end
end

local ok = parts <= maxParts
print(serde.encode("json", { instances = instances, parts = parts, maxParts = maxParts, ok = ok }))
process.exit(if ok then 0 else 1)
