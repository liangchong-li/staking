const { deployments, upgrades } = require("hardhat");
const fs = require("fs")
const path = require("path")

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { save } = deployments;
    const { deployer } = await getNamedAccounts();
    console.log("部署用户地址：", deployer);

    // 获取当前网络配置
    const network = await ethers.provider.getNetwork();
    console.log("网络名称:", network.name);
    console.log("网络链ID:", network.chainId);

    // 1. 读取配置文件
    const config = require("../deploy-config.js");
    const networkConfig = config.getConfig(network.name);

    const Stake = await ethers.getContractFactory("Stake");

    // 准备初始化参数
    // 注意：这里需要根据实际情况设置这些参数
    // 您可能需要先部署一个ERC20代币作为奖励代币，或者使用已有的代币地址
    const rewardTokenAddress = networkConfig.rewardToken; // 替换为实际的奖励代币地址
    const startBlock = (await ethers.provider.getBlockNumber()) + networkConfig.startBlockOffset; // 从当前区块+100开始
    const endBlock = startBlock + networkConfig.durationBlocks; // 持续100000个区块
    const rewardTokenPerBlock = networkConfig.rewardPerBlock; // 每个区块奖励1个代币（带18位小数）

    console.log("初始化参数:");
    console.log("奖励代币地址:", rewardTokenAddress);
    console.log("开始区块:", startBlock);
    console.log("结束区块:", endBlock);
    console.log("每个区块奖励:", rewardTokenPerBlock.toString());

    // 通过代理合约部署
    try {
        console.log("正在部署代理合约...");
        // 第二个参数：初始化函数参数列表
        const stakeProxy = await upgrades.deployProxy(
            Stake,
            [rewardTokenAddress, startBlock, endBlock, rewardTokenPerBlock],
            {
                initializer: "initialize",
                kind: "uups"  // 指定使用UUPS代理模式
            });
        await stakeProxy.waitForDeployment();

        const proxyAddress = await stakeProxy.getAddress();
        const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

        console.log("部署成功!");
        console.log("代理合约地址：", proxyAddress);
        console.log("实现合约地址：", implAddress);
        console.log("Admin Role Hash:", await stakeProxy.ADMIN_ROLE());
        console.log("Upgrade Role Hash:", await stakeProxy.UPGRADE_ROLE());
        console.log("ETH Pool ID:", await stakeProxy.ETH_PID());

        // 保存部署信息
        const storePath = path.resolve(__dirname, "./.cache/proxyStake.json");
        fs.writeFileSync(
            storePath,
            JSON.stringify({
                network: network.name,
                chainId: network.chainId,
                proxyAddress: proxyAddress,
                implAddress: implAddress,
                adminRole: await stakeProxy.ADMIN_ROLE(),
                upgradeRole: await stakeProxy.UPGRADE_ROLE(),
                deployer: deployer,
                deployedAt: new Date().toISOString(),
                abi: Stake.interface.format("json"),
            }, serializeBigInt, 2)
        );

        console.log("部署信息已保存到:", storePath);

        // 使用hardhat-deploy保存。
        // hardhat-deploy 插件只接受 address、abi 和 linkedData（可选）。其他信息保存到上面代码中的自定义文件。
        await save("StakeProxy", {
            abi: Stake.interface.format("json"),
            address: proxyAddress,
            network: network.name,
            chainId: network.chainId,
            deployer: deployer,
            deployedAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error("部署失败:", error);
        throw error;
    }
};

// 添加一个处理 BigInt 的序列化函数
function serializeBigInt(key, value) {
    if (typeof value === 'bigint') {
        return value.toString(); // 转换为字符串
    }
    return value;
}

module.exports.tags = ['depolyStake'];