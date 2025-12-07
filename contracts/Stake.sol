// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import "hardhat/console.sol";

contract Stake is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;
    using Math for uint256;

    // user结构体
    struct User {
        // 用户质押代币数
        uint256 stAmount;
        // 已分配的奖励币数量
        uint256 finishedRewardToken;
        // 待领取的奖励币数量（当用户更新了质押代币数时，按）
        uint256 pendingRewardToken;
        // 解质押请求列表，每个请求包含解质押数量和解锁区块
        Request[] requestes;
    }

    // 请求结构体
    struct Request {
        uint256 amount;
        uint256 unlockBlocks;
    }

    // 质押池
    struct Pool {
        // 质押token地址
        address stTokenAddress;
        // 权重
        uint256 poolWeight;
        // 最后一次计算奖励的区块号。
        uint256 lastRewardBlock;
        // 每个质押代币累积的奖励币数量。
        uint256 accRewardTokenPerST;
        // 池中质押代币总数
        uint256 stTokenAmount;
        // 最小质押金额。
        uint256 minDepositAmount;
        // 解除质押的锁定区块数。
        uint256 unstakeLockedBlocks;
    }

    bytes32 public constant ADMIN_ROLE = keccak256("admin_role");
    bytes32 public constant UPGRADE_ROLE = keccak256("upgrade_role");
    // ETH 池，默认为第一个池
    uint256 public constant ETH_PID = 0;

    // 奖励的token
    IERC20 public RewardToken;

    // 开始区块（计算收益）
    uint256 public startBlock;
    // 结束区块（计算收益）
    uint256 public endBlock;
    // 每个区块产出多少个奖励token
    uint256 public rewardTokenPerBlock;

    // 总质押池权重
    uint256 public totalPoolsWeight;

    // 用户质押信息
    mapping(uint256 pid => mapping(address => User)) public users;

    // 质押池。第一个池固定为ETH,pid: ETH_PID
    Pool[] public pools;

    // 质押开关
    bool public pausedDeposit;

    // 领取开关
    bool public pausedClaim;

    // 提现开关
    bool public pausedWithdraw;

    ///////////////////// 事件定义 ////////////////////
    // 新增池基本信息事件
    event AddPool(
        address indexed stTokenAddress,
        uint256 indexed poolWeight,
        uint256 indexed lastRewardBlock,
        uint256 minDepositAmount,
        uint256 unstakeLockedBlocks
    );

    // 更新池基本信息事件
    event UpdatePool(
        uint256 indexed poolId,
        uint256 indexed minDepositAmount,
        uint256 indexed unstakeLockedBlocks
    );

    // 更新池奖励信息
    event UpdatePoolReward(
        uint256 indexed poolId,
        uint256 indexed lastRewardBlock,
        uint256 poolRewardToken
    );

    // 质押事件
    event Deposit(uint256 indexed pid, address indexed user, uint256 amount);

    // 撤回质押事件
    event Unstake(uint256 indexed pid, address indexed user, uint256 amount);

    event Claim(uint256 indexed pid, address user, uint256 peedingToken);

    // 提现事件
    event Withdraw(
        uint256 indexed pid,
        address indexed user,
        uint256 sumWithdraw,
        uint256 blockNumber
    );

    // 设置奖励token
    event SetRewardToken(IERC20 indexed rewardToken);

    // 质押开关事件
    event SetpausedDeposit(bool indexed isPause);

    // 解除质押开关事件
    event SetPauseUnstake(bool indexed isPause);

    // 提现开关事件
    event SetpausedWithdraw(bool indexed isPause);

    event SetpausedClaim(bool indexed isPause);

    event SetStartBlock(uint256 indexed startBlock);

    event SetEndBlock(uint256 indexed endBlock);

    event SetRewardTokenPerBlock(uint256 indexed rewardTokenBlock);

    event SetPoolWeight(
        uint256 indexed pid,
        uint256 indexed poolWeight,
        uint256 totalPoolWeight
    );

    modifier checkPid(uint256 pid) {
        require(pid < pools.length, "invalid pid");
        _;
    }

    modifier whenNotClaimPaused() {
        require(!pausedClaim, "claim is paused");
        _;
    }

    modifier whenNotWithdrawPaused() {
        require(!pausedWithdraw, "withdraw is paused");
        _;
    }

    function initialize(
        IERC20 _rewardToken,
        uint256 _startBlock,
        uint256 _endBlock,
        uint256 _rewardTokenPerBlock
    ) public initializer {
        require(
            _startBlock <= _endBlock && _rewardTokenPerBlock > 0,
            "invalid parameters"
        );
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());
        _grantRole(UPGRADE_ROLE, _msgSender());

        setRewardToken(_rewardToken);

        startBlock = _startBlock;
        endBlock = _endBlock;
        rewardTokenPerBlock = _rewardTokenPerBlock;
    }

    /**
     * 添加质押池
     * @param stTokenAddress 质押token地址
     * @param poolWeight 池的权重
     * @param minDepositAmount 往池中质押的最小代币数
     * @param unstakeLockedBlocks token解锁需要历经的新区块数
     * @param withUpdate 是否更新所有池的奖励信息
     */
    function addPool(
        address stTokenAddress,
        uint256 poolWeight,
        uint256 minDepositAmount,
        uint256 unstakeLockedBlocks,
        bool withUpdate
    ) public onlyRole(ADMIN_ROLE) {
        // 有且仅有第一个池，放入ETH
        if (pools.length > 0) {
            require(
                stTokenAddress != address(0),
                "No first pool must not to be ETH"
            );
        } else {
            require(stTokenAddress == address(0), "First pool must to be ETH");
        }

        require(
            unstakeLockedBlocks > 0,
            "unstakeLockedBlocks must be gether than 0"
        );
        require(block.number < endBlock, "Already ended");

        if (withUpdate) {
            allUpdatePoolReward();
        }
        uint256 lastRewardBlock = block.number > startBlock
            ? block.number
            : startBlock;
        totalPoolsWeight += poolWeight;
        pools.push(
            Pool({
                stTokenAddress: stTokenAddress,
                poolWeight: poolWeight,
                minDepositAmount: minDepositAmount,
                unstakeLockedBlocks: unstakeLockedBlocks,
                lastRewardBlock: lastRewardBlock,
                accRewardTokenPerST: 0,
                stTokenAmount: 0
            })
        );
        emit AddPool(
            stTokenAddress,
            poolWeight,
            lastRewardBlock,
            minDepositAmount,
            unstakeLockedBlocks
        );
    }

    /**
     * 更新质押池信息，仅允许更新 minDepositAmount、unstakeLockedBlocks
     * @param pid 池id
     * @param minDepositAmount 质押的最小代币数
     * @param unstakeLockedBlocks token解锁需要历经的新区块数
     */
    function updatePool(
        uint256 pid,
        uint256 minDepositAmount,
        uint256 unstakeLockedBlocks
    ) public onlyRole(ADMIN_ROLE) checkPid(pid) {
        pools[pid].minDepositAmount = minDepositAmount;
        pools[pid].unstakeLockedBlocks = unstakeLockedBlocks;

        emit UpdatePool(pid, minDepositAmount, unstakeLockedBlocks);
    }

    // 设置池权重。更新所有池总权重
    function setPoolWeight(
        uint256 pid,
        uint256 poolWeight,
        bool withUpdate
    ) public onlyRole(ADMIN_ROLE) {
        require(poolWeight > 0, "invalid pool weight");

        if (withUpdate) {
            allUpdatePoolReward();
        }

        totalPoolsWeight =
            totalPoolsWeight -
            pools[pid].poolWeight +
            poolWeight;
        pools[pid].poolWeight = poolWeight;
        emit SetPoolWeight(pid, poolWeight, totalPoolsWeight);
    }

    // 更新所有池的奖励信息。谨慎使用，小心 gas 消耗
    function allUpdatePoolReward() public {
        uint256 length = pools.length;
        for (uint256 pid = 0; pid < length; pid++) {
            updatePoolReward(pid);
        }
    }

    /**
     * 更新池的奖励信息
     * 计算该池，自上次结算至目前，所有产生的代币奖励，应该分配给每个质押的份额（即每次需要结算奖励时，必须调用本函数获取最新的奖励因子）
     * @param pid 池id
     */
    function updatePoolReward(uint pid) public checkPid(pid) {
        Pool storage pool = pools[pid];
        // console.log("updatePoolReward block.number", block.number);
        // console.log("updatePoolReward pool.lastRewardBlock", pool.lastRewardBlock);
        // 已是最新状态
        if (block.number <= pool.lastRewardBlock) {
            return;
        }

        // 更新池中奖励
        // 新出区块产出的奖励 token
        uint256 allRewardToken = getBlockRewardToken(
            pool.lastRewardBlock,
            block.number
        );
        // console.log("updatePoolReward allRewardToken: ", allRewardToken);
        // 根据权重，计算这个池的奖励。  精度因子，膨胀 1e18
        uint256 poolRewardToken = (allRewardToken * pool.poolWeight) /
            totalPoolsWeight;
        // console.log("updatePoolReward poolRewardToken: ", poolRewardToken);

        // 如果没有质押代币，更新为最新状态，然后结束
        uint256 stTokenAmount = pool.stTokenAmount;
        if (stTokenAmount != 0) {
            // TODO : 精度膨胀后，什么时候缩小？
            uint256 poolRewardToken_ = poolRewardToken * 1e18;
            // 平均到每个代币的奖励
            uint256 stTokenRewardToken = poolRewardToken_ / stTokenAmount;

            // 更新到池
            pool.accRewardTokenPerST += stTokenRewardToken;
            pool.lastRewardBlock = block.number;
            console.log("pool.accRewardTokenPerST: ", pool.accRewardTokenPerST);
        }

        pool.lastRewardBlock = block.number;

        // 更新区块事件
        emit UpdatePoolReward(pid, pool.lastRewardBlock, poolRewardToken);
    }

    // 质押 ETH
    function depositETH() public payable whenNotPaused {
        // 异常处理: 质押数量低于最小质押要求时拒绝交易。
        Pool storage pool = pools[ETH_PID];
        uint256 amount = msg.value;
        require(amount >= pool.minDepositAmount, "deposit amount is too small");

        _deposit(ETH_PID, amount);
    }

    /**
     * 质押 ERC20
     * @param pid 池id
     * @param amount 质押金额
     */
    function deposit(
        uint pid,
        uint256 amount
    ) public whenNotPaused checkPid(pid) {
        // 异常处理: 质押数量低于最小质押要求时拒绝交易。
        Pool storage pool = pools[pid];
        require(amount > pool.minDepositAmount, "deposit amount is too small");

        if (amount > 0) {
            // 将质押的代币转移到本合约
            IERC20(pool.stTokenAddress).safeTransferFrom(
                _msgSender(),
                address(this),
                amount
            );
        }

        _deposit(pid, amount);
    }

    /**
     * 质押
     */
    function _deposit(uint _pid, uint256 _amount) internal {
        Pool storage pool = pools[_pid];
        User storage user = users[_pid][_msgSender()];

        // 更新池奖励因子信息
        updatePoolReward(_pid);

        // 1 计算未领取奖励
        if (user.stAmount > 0) {
            // 计算用户奖励（池每个质押获得的奖励因子已更新）; 去除缩放因子
            uint256 accSt = (user.stAmount * pool.accRewardTokenPerST) /
                (1 ether);

            // 减去已获得的奖励
            uint peedingRewardToken = accSt - user.finishedRewardToken;
            if (peedingRewardToken > 0) {
                user.pendingRewardToken += peedingRewardToken;
            }
        }

        // 2 更新质押信息
        if (_amount > 0) {
            // 2.1 更新用户质押信息
            user.stAmount += _amount;
            // 2.2 更新池质押信息
            pool.stTokenAmount += _amount;
        }

        // 3 计算已分配奖励（在当前检查点下，我质押的数量应该获得的奖励）
        uint256 finishedRewardToken = (user.stAmount *
            pool.accRewardTokenPerST) / (1 ether);
        user.finishedRewardToken = finishedRewardToken;
        // console.log("_deposit user.pendingRewardToken:", user.pendingRewardToken);
        // console.log("_deposit user.finishedRewardToken:", user.finishedRewardToken);
        emit Deposit(_pid, _msgSender(), _amount);
    }

    /**
     * 解除质押
     * @param pid 池id
     * @param amount 质押金额
     */
    function unstake(
        uint256 pid,
        uint256 amount
    ) public checkPid(pid) whenNotWithdrawPaused {
        User storage user = users[pid][_msgSender()];
        Pool storage pool = pools[pid];

        require(amount <= user.stAmount, "Not enough staking token balance");

        // 更新池信息
        updatePoolReward(pid);

        // 计算待提取奖励
        uint256 pendingRewardToken = (user.stAmount *
            pool.accRewardTokenPerST) /
            (1 ether) -
            user.finishedRewardToken;
        if (pendingRewardToken > 0) {
            user.pendingRewardToken += pendingRewardToken;
        }

        // 将提取请求放入user的请求列表
        if (amount > 0) {
            user.stAmount -= amount;
            user.requestes.push(
                Request({
                    amount: amount,
                    unlockBlocks: block.number + pool.unstakeLockedBlocks
                })
            );
        }

        // 更新质押数
        pool.stTokenAmount -= amount;
        user.finishedRewardToken =
            (user.stAmount * pool.accRewardTokenPerST) /
            (1 ether);

        emit Unstake(pid, _msgSender(), amount);
    }

    /**
     * 质押提现
     * @param pid 池id
     */
    function withdraw(uint256 pid) public checkPid(pid) whenNotWithdrawPaused {
        Pool storage pool = pools[pid];
        User storage user = users[pid][_msgSender()];
        if (user.requestes.length == 0) {
            return;
        }

        // 1 计算提现金额
        // 需要删除的请求，请求按区块高度顺序
        uint256 popIndex;
        // 待提现总代币数
        uint256 pendingWithdraw;
        for (uint256 i = 0; i < user.requestes.length; i++) {
            Request memory req = user.requestes[i];
            if (req.unlockBlocks > block.number) {
                break;
            }
            pendingWithdraw += req.amount;
            popIndex++;
        }

        // 将 popIndex 之后的元素移动到数组开头
        uint256 newLength = user.requestes.length - popIndex;
        for (uint i = 0; i < newLength; i++) {
            user.requestes[i] = user.requestes[popIndex + i];
        }

        // 截断数组
        while (user.requestes.length > newLength) {
            user.requestes.pop();
        }

        // 2 提现
        if (pendingWithdraw > 0) {
            if (pool.stTokenAddress == address(0)) {
                // 2.1 质押的ETH
                _safeETHTransfer(_msgSender(), pendingWithdraw);
            } else {
                // 2.2 质押的ECR20
                IERC20(pool.stTokenAddress).safeTransfer(
                    _msgSender(),
                    pendingWithdraw
                );
            }
        }

        emit Withdraw(pid, _msgSender(), pendingWithdraw, block.number);
    }

    /**
     * @notice Safe ETH transfer function
     *
     * @param _to        Address to get transferred ETH
     * @param _amount    Amount of ETH to be transferred
     */
    function _safeETHTransfer(address _to, uint256 _amount) internal {
        (bool success, bytes memory data) = address(_to).call{value: _amount}(
            ""
        );

        require(success, "ETH transfer call failed");
        if (data.length > 0) {
            require(
                abi.decode(data, (bool)),
                "ETH transfer operation did not succeed"
            );
        }
    }

    // 领取代币奖励
    function claim(
        uint256 pid
    ) public whenNotPaused checkPid(pid) whenNotClaimPaused {
        Pool storage pool = pools[pid];
        User storage user = users[pid][_msgSender()];

        // 更新，然后按照最新的系数领取
        updatePoolReward(pid);

        uint256 curPeedingToken = (user.stAmount * pool.accRewardTokenPerST) /
            (1 ether);
        uint256 peedingToken = curPeedingToken -
            user.finishedRewardToken +
            user.pendingRewardToken;
        // console.log("claim user.stAmount: ", user.stAmount);
        // console.log(
        //     "claim pool.accRewardTokenPerST: ",
        //     pool.accRewardTokenPerST
        // );
        // console.log("claim curPeedingToken: ", curPeedingToken);
        // console.log("claim finishedRewardToken: ", user.finishedRewardToken);
        // console.log("claim pendingRewardToken: ", user.pendingRewardToken);
        // console.log("claim peedingToken: ", peedingToken);
        if (peedingToken > 0) {
            user.pendingRewardToken = 0;
            _safeRewardTokenTransfer(_msgSender(), peedingToken);
        }
        user.finishedRewardToken = curPeedingToken;

        emit Claim(pid, _msgSender(), peedingToken);
    }

    function _safeRewardTokenTransfer(address to, uint256 amount) internal {
        require(
            amount < RewardToken.balanceOf(address(this)),
            "RewardToken balance not enough"
        );
        RewardToken.transfer(to, amount);
    }

    // 计算出块奖励
    function getBlockRewardToken(
        uint256 fromBlock,
        uint256 toBlock
    ) internal view returns (uint256 rewardToken) {
        require(fromBlock <= toBlock, "invalid block range");
        // 与预设开始挖矿区块比较，取更高值
        fromBlock = fromBlock < startBlock ? startBlock : fromBlock;
        // 与预设结束挖矿区块比较，取更低值
        toBlock = toBlock > endBlock ? endBlock : toBlock;
        require(
            fromBlock <= toBlock,
            "end block must be greater than start block"
        );

        // console.log("toBlock: ", toBlock);
        // console.log("fromBlock: ", fromBlock);
        // console.log("rewardTokenPerBlock: ", rewardTokenPerBlock);
        rewardToken = (toBlock - fromBlock) * rewardTokenPerBlock;
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyRole(UPGRADE_ROLE) {}

    /////////////// admin fucntion ////////////////////

    // 更换奖励币
    function setRewardToken(IERC20 rewardToken) public onlyRole(ADMIN_ROLE) {
        RewardToken = rewardToken;
        emit SetRewardToken(rewardToken);
    }

    // 设置质押开关
    function setpausedDeposit(bool isPause) public onlyRole(ADMIN_ROLE) {
        pausedDeposit = isPause;
        emit SetpausedDeposit(isPause);
    }

    // 设置提现开关
    function setpausedWithdraw(bool isPause) public onlyRole(ADMIN_ROLE) {
        pausedWithdraw = isPause;
        emit SetpausedWithdraw(isPause);
    }

    // 设置提取奖励开关
    function setpausedClaim(bool isPause) public onlyRole(ADMIN_ROLE) {
        pausedClaim = isPause;
        emit SetpausedClaim(isPause);
    }

    // 设置奖励发放初始区块
    function setStartBlock(uint256 _startBlock) public onlyRole(ADMIN_ROLE) {
        require(
            _startBlock <= endBlock,
            "start block must be smaller than end block"
        );

        startBlock = _startBlock;
        emit SetStartBlock(_startBlock);
    }

    // 设置奖励发放结束区块
    function setEndBlock(uint256 _endBlock) public onlyRole(ADMIN_ROLE) {
        require(
            startBlock <= _endBlock,
            "start block must be smaller than end block"
        );

        endBlock = _endBlock;
        emit SetEndBlock(_endBlock);
    }

    // 设置每个区块出的励币个数
    function setRewardTokenPerBlock(
        uint256 _rewardTokenPerBlock
    ) public onlyRole(ADMIN_ROLE) {
        require(_rewardTokenPerBlock > 0, "invalid parameter");

        rewardTokenPerBlock = _rewardTokenPerBlock;
        emit SetRewardTokenPerBlock(_rewardTokenPerBlock);
    }

    ///////////////////////////查询接口/////////////////////////////////
    // 查询池数量
    function poolLength() public view returns (uint256) {
        return pools.length;
    }

    // 查询用户，在某个池中的质押数
    function stakingBalance(
        uint256 pid,
        address user
    ) external view checkPid(pid) returns (uint256) {
        return users[pid][user].stAmount;
    }

    /**
     * @notice 查询用户在池中的待领取奖励
     */
    function getPendingRewardToken(
        uint256 pid,
        address user
    ) external view checkPid(pid) returns (uint256) {
        return getPendingRewardTokenByBlockNumber(pid, user, block.number);
    }

    /**
     * @notice 查询用户在池中，指定区块时的待领取奖励
     */
    function getPendingRewardTokenByBlockNumber(
        uint256 _pid,
        address _user,
        uint256 _blockNumber
    ) public view checkPid(_pid) returns (uint256) {
        Pool storage pool = pools[_pid];
        User storage user = users[_pid][_user];
        uint256 accRewardTokenPerST = pool.accRewardTokenPerST;
        uint256 stSupply = pool.stTokenAmount;

        if (_blockNumber > pool.lastRewardBlock && stSupply != 0) {
            uint256 allBlockRewardToken = getBlockRewardToken(
                pool.lastRewardBlock,
                _blockNumber
            );
            // console.log(
            //     "getPendingRewardTokenByBlockNumber,allBlockRewardToken: ",
            //     allBlockRewardToken
            // );
            uint256 rewardTokenForPool = (allBlockRewardToken *
                pool.poolWeight) / totalPoolsWeight;

            accRewardTokenPerST =
                accRewardTokenPerST +
                (rewardTokenForPool * (1 ether)) /
                stSupply;
            // console.log(
            //     "getPendingRewardTokenByBlockNumber,rewardTokenForPool: ",
            //     rewardTokenForPool
            // );
            // console.log(
            //     "getPendingRewardTokenByBlockNumber,accRewardTokenPerST: ",
            //     accRewardTokenPerST
            // );
        }

        return
            (user.stAmount * accRewardTokenPerST) /
            (1 ether) -
            user.finishedRewardToken +
            user.pendingRewardToken;
    }
}
